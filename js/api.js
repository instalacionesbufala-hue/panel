// Única capa que habla con el backend. Ningún otro módulo hace fetch.

// URL de la implementación activa de Apps Script. Es el único sitio donde se configura.
export const URL_BACKEND = 'https://script.google.com/macros/s/AKfycbxMMeyP9g75p1lxytithxeFfQVbe0cXV3aFHlJObfI05ewIN1mtTxPYBNPYp--BPKc9tw/exec';

// Acciones del panel que conoce esta interfaz.
export const TODAS = ['panelLogin', 'panelConfig', 'panelCompras', 'panelLiquidacion', 'panelCostes', 'panelGuardarConfig',
  'panelAsignarCombustible', 'panelClasificarProveedor', 'panelCostesTecnico', 'panelFacturaDetalle', 'panelClasificarFactura',
  'panelAusencias', 'panelGuardarAusencia', 'panelBorrarAusencia',
  'panelFestivos', 'panelGuardarFestivo', 'panelBorrarFestivo', 'panelPrecios', 'panelGuardarPrecios',
  'panelParametrosUnidades', 'panelGuardarParametroUnidad'];
// Acciones de la página de la Dirección General (direccion.html): testigo propio, solo lectura.
export const TODAS_DIRECCION = ['direccionLogin', 'direccionIndicadores', 'direccionInforme'];

// Qué acciones van a producción lo dice el backend: GET ?action=ping devuelve
// { panel: true, accionesPanel: [...] }. Las que figuren ahí van a producción; el resto se
// sirve en modo demostración con los datos de ejemplo de más abajo. Así no hay que tocar
// este fichero cada vez que el backend añade una acción.
// Se pregunta una vez por carga de página; si falla, se vuelve a intentar en la siguiente llamada.
let esperaAcciones = null;
export function accionesEnProduccion() {
  if (!esperaAcciones) {
    esperaAcciones = aProduccion('ping', { conTestigo: false })
      .then(r => new Set(r.panel === true && Array.isArray(r.accionesPanel) ? r.accionesPanel.filter(a => TODAS.includes(a) || TODAS_DIRECCION.includes(a)) : []))
      .catch(e => { esperaAcciones = null; throw e; });
  }
  return esperaAcciones;
}

const CLAVE_TESTIGO = 'bufala-panel-testigo';
// Si Google no contesta en 30 s o devuelve su página de error, se reintenta una vez a los 4 s
// (BACKEND.md v3.20.28: todas las escrituras son seguras de repetir).
const ESPERA_MAX_MS = 30000;
const PAUSA_REINTENTO_MS = 4000;

export class ErrorApi extends Error {
  // tipo: 'red' (no hay conexión), 'contrato' (respuesta que no cumple el contrato),
  //       'backend' (el backend rechaza), 'bloqueado' (demasiados intentos), 'sesion' (hay que volver a entrar)
  constructor(mensaje, tipo) {
    super(mensaje);
    this.tipo = tipo;
  }
}

// ── Sesión ──────────────────────────────────────────────
let testigoEnMemoria = null;
function leerTestigo() {
  try {
    const t = JSON.parse(sessionStorage.getItem(CLAVE_TESTIGO) || 'null');
    return t && t.token ? t : null;
  } catch {
    return null;
  }
}
function guardarTestigo(token, caduca) {
  testigoEnMemoria = { token, caduca: caduca || null };
  try { sessionStorage.setItem(CLAVE_TESTIGO, JSON.stringify(testigoEnMemoria)); } catch { /* sin almacenamiento: la sesión dura lo que la pestaña */ }
}
function testigoActual() {
  const t = leerTestigo() || testigoEnMemoria;
  if (!t) return null;
  if (t.caduca && Date.parse(t.caduca) <= Date.now()) { cerrarSesion(); return null; }
  return t.token;
}
export function haySesion() { return !!testigoActual(); }
export function cerrarSesion() {
  testigoEnMemoria = null;
  try { sessionStorage.removeItem(CLAVE_TESTIGO); } catch { /* nada */ }
}

// La aplicación registra aquí cómo pedir la contraseña. Devuelve una promesa
// que se resuelve cuando el usuario ha vuelto a entrar.
let pedirAcceso = () => Promise.reject(new ErrorApi('Sesión caducada.', 'sesion'));
export function alPedirAcceso(fn) { pedirAcceso = fn; }

// Estado de la conexión, para la franja de aviso.
const oyentes = new Set();
export function alCambiarConexion(fn) { oyentes.add(fn); }
function avisarConexion(ok, detalle) { oyentes.forEach(fn => fn(ok, detalle)); }
// «Reintentando…» y «los costes se actualizan en 1-2 minutos», para que la aplicación los enseñe
const oyentesReintento = new Set(), oyentesCostesEnCola = new Set();
export function alReintentar(fn) { oyentesReintento.add(fn); }
export function alCostesEnCola(fn) { oyentesCostesEnCola.add(fn); }

// ── Transporte a producción ────────────────────────────
function esSesionCaducada(r) {
  const c = String(r.codigo || r.code || '').toLowerCase();
  return c === 'sesion' || c === 'sesion_caducada' || r.sesionCaducada === true;
}

// Apps Script atiende una sola ejecución a la vez por usuario: las peticiones simultáneas se
// encolan en Google y la última puede pasarse de tiempo (BACKEND.md v3.20.18). Por eso todas las
// peticiones a producción pasan por esta cola y salen de una en una. La demostración no la usa.
let colaProduccion = Promise.resolve();
function enCola(tarea) {
  const turno = colaProduccion.then(tarea, tarea);
  colaProduccion = turno.catch(() => {});
  return turno;
}

async function aProduccion(accion, opciones = {}) {
  // La comprobación va fuera de la cola: consulta el ping, que también se encola.
  if (accion !== 'ping' && !(await accionesEnProduccion()).has(accion)) {
    throw new ErrorApi(`La acción «${accion}» no figura entre las implementadas en el backend.`, 'contrato');
  }
  return enCola(() => conReintento(accion, opciones));
}

// Un solo reintento, y solo para fallos de Google (página de error, sin respuesta o más de 30 s).
// Un «no» del backend (ok:false) nunca se repite. La franja de conexión solo sale si falla el segundo.
async function conReintento(accion, opciones) {
  try {
    return await enviarAProduccion(accion, opciones);
  } catch (e) {
    if (!e.reintentable) throw e;
    oyentesReintento.forEach(fn => fn(accion));
    await new Promise(r => setTimeout(r, PAUSA_REINTENTO_MS));
    try {
      return await enviarAProduccion(accion, opciones);
    } catch (e2) {
      if (e2.tipo === 'red') avisarConexion(false, e2.detalleConexion || '');
      throw e2;
    }
  }
}

async function enviarAProduccion(accion, { metodo = 'GET', params = {}, cuerpo = null, conTestigo = true, testigoExplicito = null } = {}) {
  const url = new URL(URL_BACKEND);
  // testigoExplicito: el de la Dirección, que no se mezcla con la sesión del panel
  const token = testigoExplicito || (conTestigo ? testigoActual() : null);
  const opciones = { method: metodo, redirect: 'follow' };

  if (metodo === 'GET') {
    url.searchParams.set('action', accion);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (token) url.searchParams.set('token', token);
  } else {
    // La acción va dentro de payload. application/x-www-form-urlencoded: petición simple, sin comprobación previa CORS
    const form = new URLSearchParams();
    form.set('payload', JSON.stringify({ accion, ...(cuerpo ?? {}) }));
    if (token) form.set('token', token);
    opciones.body = form;
  }

  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), ESPERA_MAX_MS);
  opciones.signal = control.signal;

  let texto;
  const inicio = Date.now();
  try {
    const resp = await fetch(url, opciones);
    texto = await resp.text();
  } catch (e) {
    // La página de error de Google no trae cabeceras CORS: el navegador la ve como fallo de red
    const err = new ErrorApi(
      e.name === 'AbortError'
        ? 'El servidor no ha respondido a tiempo, ni al reintentarlo. Lo que has escrito sigue en pantalla: vuelve a intentarlo en un minuto.'
        : 'No se puede contactar con el servidor, ni al reintentarlo. Si tienes conexión, suele ser un fallo momentáneo de Google: espera un minuto y vuelve a intentarlo. Lo que has escrito sigue en pantalla.',
      'red');
    err.reintentable = true;
    err.detalleConexion = e.name === 'AbortError' ? 'El servidor tarda demasiado en responder.' : '';
    throw err;
  } finally {
    clearTimeout(temporizador);
  }

  let datos;
  try {
    datos = JSON.parse(texto);
  } catch {
    avisarConexion(true);
    const segundos = Math.round((Date.now() - inicio) / 1000);
    const err = new ErrorApi(`El servidor ha fallado al responder a «${accion}» (tras ${segundos} s)${motivoPaginaError(texto)}, también al reintentarlo. `
      + 'No es un fallo del panel: hay que avisar al backend. Puedes volver a intentarlo.', 'backend');
    err.reintentable = true;
    throw err;
  }
  avisarConexion(true);

  if (datos && datos.ok === false) {
    if (esSesionCaducada(datos)) throw new ErrorApi(datos.error || 'La sesión ha caducado.', 'sesion');
    if (datos.rechazado) throw new ErrorApi(datos.error || `El servidor no admite la acción «${accion}».`, 'contrato');
    if (datos.bloqueado) throw new ErrorApi(datos.error || 'Demasiados intentos fallidos: el acceso está bloqueado temporalmente.', 'bloqueado');
    throw new ErrorApi(datos.error || 'El servidor ha rechazado la operación sin indicar el motivo.', 'backend');
  }
  if (!datos || datos.ok !== true) throw new ErrorApi(`Respuesta inesperada del servidor en «${accion}».`, 'contrato');
  // En las escrituras (salvo el acceso, que se valida por el testigo) el backend debe repetir la acción
  if (metodo !== 'GET' && accion !== 'panelLogin' && accion !== 'direccionLogin' && datos.accion !== accion) {
    throw new ErrorApi(`El servidor ha respondido a «${accion}» sin confirmarla. No se da por guardado.`, 'contrato');
  }
  // Los guardados contestan enseguida y dejan el recálculo de costes en cola (1-2 minutos)
  if (datos.costesEnCola) oyentesCostesEnCola.forEach(fn => fn(accion));
  return datos;
}

// Cada escritura con la lectura de la que depende. Una escritura solo se permite si va por el
// mismo camino que su lectura: así nunca se guarda en la demostración algo que se ha leído del
// sistema real, ni se envía al sistema real algo que se ha leído de la demostración.
const LECTURA_DE = {
  panelGuardarConfig: 'panelConfig',
  panelAsignarCombustible: 'panelCompras',
  panelClasificarProveedor: 'panelCompras',
  panelClasificarFactura: 'panelCompras',
  panelCostesTecnico: 'panelCostes',
  panelGuardarAusencia: 'panelAusencias',
  panelBorrarAusencia: 'panelAusencias',
  panelGuardarFestivo: 'panelFestivos',
  panelBorrarFestivo: 'panelFestivos',
  panelGuardarPrecios: 'panelPrecios',
  panelGuardarParametroUnidad: 'panelParametrosUnidades',
};

// Cuando Apps Script falla, Google devuelve una página HTML. Se extrae su mensaje para mostrarlo.
function motivoPaginaError(html) {
  try {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const msg = (doc.querySelector('.errorMessage')?.textContent || doc.title || '').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
    return msg ? `: «${msg.slice(0, 160)}»` : '';
  } catch {
    return '';
  }
}

async function peticion(accion, opciones = {}) {
  const enProduccion = await accionesEnProduccion();
  const lectura = LECTURA_DE[accion];
  if (lectura && enProduccion.has(accion) !== enProduccion.has(lectura)) {
    throw new ErrorApi(enProduccion.has(lectura)
      ? 'Estos datos ya son los reales, pero el servidor todavía no admite cambios. No se ha guardado nada.'
      : 'El servidor admite este cambio, pero los datos de pantalla son de ejemplo. No se ha guardado nada.', 'solo-lectura');
  }
  return enProduccion.has(accion) ? aProduccion(accion, opciones) : demostracion(accion, opciones);
}

// Si la sesión caduca, se pide la contraseña encima de la vista y se repite la llamada.
async function llamar(accion, opciones) {
  if (!testigoActual()) await pedirAcceso('Introduce la contraseña del panel.');
  try {
    return await peticion(accion, opciones);
  } catch (e) {
    if (e.tipo !== 'sesion') throw e;
    cerrarSesion();
    await pedirAcceso('La sesión ha caducado. Vuelve a entrar; no se ha perdido nada de lo que estabas haciendo.');
    return peticion(accion, opciones);
  }
}

// ── Acciones del contrato ──────────────────────────────
export async function entrar(clave) {
  // El acceso nunca se simula: si el backend no lo tiene, no se entra
  if (!(await accionesEnProduccion()).has('panelLogin')) throw new ErrorApi('El servidor todavía no tiene activado el acceso al panel.', 'contrato');
  const r = await aProduccion('panelLogin', { metodo: 'POST', cuerpo: { clave }, conTestigo: false });
  if (!r.token) throw new ErrorApi('El servidor no ha devuelto el testigo de sesión.', 'contrato');
  guardarTestigo(r.token, r.caduca);
  return r;
}

// panelConfig tarda varios segundos: se guarda una copia en memoria (nunca en el navegador) y se
// reutiliza al cambiar de pantalla. Solo se guardan lecturas correctas, así que «Reintentar» tras un
// error vuelve a preguntar. La copia se olvida al guardar cambios y caduca a los 10 minutos.
const VIDA_COPIA_CONFIG_MS = 10 * 60 * 1000;
let copiaConfig = null;   // { promesa, hora }
export function olvidarConfig() { copiaConfig = null; }
export function leerConfig() {
  if (copiaConfig && Date.now() - copiaConfig.hora < VIDA_COPIA_CONFIG_MS) return copiaConfig.promesa.then(copia);
  const promesa = llamar('panelConfig');
  const esta = { promesa, hora: Date.now() };
  copiaConfig = esta;
  promesa.catch(() => { if (copiaConfig === esta) copiaConfig = null; });
  return promesa.then(copia);
}
// panelCompras trae además `pendientes` (lo que falta por asignar en todos los meses desde mayo de 2026).
// Cada lectura lo reparte a quien escuche, para el contador del menú.
const oyentesPendientes = new Set();
export function alCambiarPendientes(fn) { oyentesPendientes.add(fn); }
export const leerCompras = async mes => {
  const r = await llamar('panelCompras', { params: { mes } });
  if ('pendientes' in r) oyentesPendientes.forEach(fn => fn(r.pendientes));
  return r;
};
export const leerLiquidacion = mes => llamar('panelLiquidacion', { params: { mes } });
export const leerCostes = (desde, hasta) => llamar('panelCostes', { params: { desde, hasta } });

export const guardarConfig = async cambios => {
  const r = await llamar('panelGuardarConfig', { metodo: 'POST', cuerpo: cambios });
  olvidarConfig();   // la siguiente lectura trae lo recién guardado
  return r;
};
export const asignarCombustible = asignaciones => llamar('panelAsignarCombustible', { metodo: 'POST', cuerpo: { asignaciones } });
export const clasificarProveedor = (proveedor, tipo) => llamar('panelClasificarProveedor', { metodo: 'POST', cuerpo: { proveedor, tipo } });
// Ausencias (BACKEND.md, encargo del 26/09/2026). Sin id = alta; con id = edición.
export const leerAusencias = (desde, hasta) => llamar('panelAusencias', { params: { desde, hasta } });
export const guardarAusencia = a => llamar('panelGuardarAusencia', { metodo: 'POST', cuerpo: a });
export const borrarAusencia = id => llamar('panelBorrarAusencia', { metodo: 'POST', cuerpo: { id } });

// Régimen de cada unidad (encargo 4): servicios/día y jornada con fecha. Con borrar: true se elimina esa fila.
export const leerParametrosUnidades = () => llamar('panelParametrosUnidades');
export const guardarParametroUnidad = p => llamar('panelGuardarParametroUnidad', { metodo: 'POST', cuerpo: p });

// Configuración (encargo 3 del 26/09/2026): festivos y precios de coste de material.
// Festivo: sin fechaAnterior = alta; con ella = edición. Precios: solo coste y notas; id y concepto no se tocan.
export const leerFestivos = anio => llamar('panelFestivos', { params: { anio } });
export const guardarFestivo = f => llamar('panelGuardarFestivo', { metodo: 'POST', cuerpo: f });
export const borrarFestivo = fecha => llamar('panelBorrarFestivo', { metodo: 'POST', cuerpo: { fecha } });
export const leerPrecios = () => llamar('panelPrecios');
export const guardarPrecios = cambios => llamar('panelGuardarPrecios', { metodo: 'POST', cuerpo: { cambios } });

// Dirección General: va a producción solo si el ping la anuncia; su testigo lo guarda direccion.js.
// Usa la misma cola y el mismo reintento que el panel. Nunca se simula aquí: la demostración la pone direccion.js.
export async function peticionDireccion(accion, { metodo = 'GET', params = {}, cuerpo = null, testigo = null } = {}) {
  if (!TODAS_DIRECCION.includes(accion)) throw new ErrorApi(`Acción desconocida: ${accion}`, 'contrato');
  if (!(await accionesEnProduccion()).has(accion)) throw new ErrorApi('Esta parte todavía no está activada en el servidor.', 'no-disponible');
  return enCola(() => conReintento(accion, { metodo, params, cuerpo, conTestigo: false, testigoExplicito: testigo }));
}

// Vista previa de una factura o línea (PDF en base64 o, si no hay, sus líneas)
export const leerFacturaDetalle = id => llamar('panelFacturaDetalle', { params: { id } });
// Clasificación de una sola factura; con tipo «materialUso», equipos entre los que se reparte a partes iguales
export const clasificarFactura = (id, tipo, equipos) =>
  llamar('panelClasificarFactura', { metodo: 'POST', cuerpo: { id, tipo, ...(equipos ? { equipos } : {}) } });
export const guardarCostes = (mes, costes, origen) => llamar('panelCostesTecnico', { metodo: 'POST', cuerpo: { mes, costes, origen } });

// ════════════════════════════════════════════════════════
// MODO DEMOSTRACIÓN
// Datos de ejemplo con la forma exacta del contrato. Viven solo en memoria: se pierden al
// recargar y nunca salen del navegador. Los importes son inventados y solo sirven para ver
// la interfaz; no son parámetros de negocio.
// ════════════════════════════════════════════════════════
const dos = n => String(n).padStart(2, '0');
const aIso = d => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
const hoyIso = () => aIso(new Date());
const mesMas = (mes, n) => { const [a, m] = mes.split('-').map(Number); const d = new Date(a, m - 1 + n, 1); return `${d.getFullYear()}-${dos(d.getMonth() + 1)}`; };
const diaAntes = iso => { const [a, m, d] = iso.split('-').map(Number); return aIso(new Date(a, m - 1, d - 1)); };
const vig = (desde, hasta, dia) => (!desde || desde <= dia) && (!hasta || hasta >= dia);
const vigMes = (desde, hasta, mes) => (!desde || desde.slice(0, 7) <= mes) && (!hasta || hasta.slice(0, 7) >= mes);
const copia = o => JSON.parse(JSON.stringify(o));

function crearDemo() {
  const M = hoyIso().slice(0, 7), P = mesMas(M, -1), A = hoyIso().slice(0, 4);
  const finP = diaAntes(`${M}-01`);
  return {
    tecnicos: [
      { id: 'T01', nombre: 'Antonio Ruiz', rol: 'Instalador', grupo: null, alta: null, baja: null },
      { id: 'T02', nombre: 'Lucía Pérez', rol: 'Instalador', grupo: null, alta: `${A}-02-01`, baja: null },
      { id: 'T03', nombre: 'Javier Gómez', rol: 'Instalador', grupo: null, alta: `${A}-04-01`, baja: null },
      { id: 'T04', nombre: 'María López', rol: 'Instalador', grupo: null, alta: `${A}-05-01`, baja: null },
      { id: 'T05', nombre: 'Pedro Sanz', rol: 'SAT', grupo: null, alta: `${A}-06-01`, baja: null },
      { id: 'T06', nombre: 'Elena Martín', rol: 'Instalador', grupo: null, alta: `${A}-01-01`, baja: finP },
      { id: 'T07', nombre: 'Carmen Vidal', rol: 'Gerencia', grupo: null, alta: `${A}-01-01`, baja: null },
    ],
    vehiculos: [
      { matricula: '1111AAA', sinMatricula: false, modelo: 'Renault Kangoo', brigada: 'Búfala 1', rentingMes: 495.87, desde: null, hasta: null },
      { matricula: '2222BBB', sinMatricula: false, modelo: 'Citroën Berlingo', brigada: 'Búfala 2', rentingMes: 470, desde: null, hasta: null },
      { matricula: '3333CCC', sinMatricula: false, modelo: 'Ford Transit', brigada: 'Búfala 3', rentingMes: 520, desde: `${A}-03-01`, hasta: null },
      { matricula: '4444DDD', sinMatricula: false, modelo: 'Toyota Corolla', brigada: 'Gerencia', rentingMes: 410, desde: `${A}-06-01`, hasta: null },
      { matricula: 'REC-017', sinMatricula: true, modelo: 'Furgoneta SAT', brigada: 'SAT', rentingMes: 350, desde: null, hasta: null },
    ],
    unidades: [
      // Los id son los nombres de brigada de la hoja (cadenas opacas); nombre es solo para mostrar
      { id: 'Búfala 1', nombre: 'Búfala 1', tipo: 'productiva', computaVariable: true, activa: true },
      { id: 'Búfala 2', nombre: 'Búfala 2', tipo: 'productiva', computaVariable: true, activa: true },
      { id: 'Búfala 3', nombre: 'Búfala 3', tipo: 'productiva', computaVariable: true, activa: true },
      { id: 'Gerencia', nombre: 'Estructura', tipo: 'no_productiva', computaVariable: false, activa: true },
      { id: 'SAT', nombre: 'SAT', tipo: 'no_productiva', computaVariable: false, activa: true },
    ],
    asignaciones: [
      { idTec: 'T01', idUnidad: 'Búfala 1', matricula: null, desde: null, hasta: finP },
      { idTec: 'T06', idUnidad: 'Búfala 1', matricula: null, desde: null, hasta: finP },
      { idTec: 'T01', idUnidad: 'Búfala 1', matricula: null, desde: `${M}-01`, hasta: null },
      { idTec: 'T02', idUnidad: 'Búfala 1', matricula: null, desde: `${M}-01`, hasta: null },
      { idTec: 'T03', idUnidad: 'Búfala 2', matricula: null, desde: `${M}-01`, hasta: null },
      { idTec: 'T05', idUnidad: 'SAT', matricula: null, desde: null, hasta: null },
      { idTec: 'T07', idUnidad: 'Gerencia', matricula: null, desde: null, hasta: null },
      // Vínculo vehículo → unidad deducido del recurso (derivada: true)
      { idTec: null, idUnidad: 'Búfala 1', matricula: '1111AAA', desde: null, hasta: null, derivada: true },
      { idTec: null, idUnidad: 'Búfala 2', matricula: '2222BBB', desde: null, hasta: null, derivada: true },
      { idTec: null, idUnidad: 'SAT', matricula: 'REC-017', desde: null, hasta: null, derivada: true },
      { idTec: null, idUnidad: 'Gerencia', matricula: '4444DDD', desde: null, hasta: null, derivada: true },
    ],
    tramos: [],   // llega vacío hasta que exista el motor de liquidación
    ejercicio: { anio: Number(A), jornadaAnual: 1770 },
    limites: { tecnicosPorUnidad: 2 },
    // Forma de BACKEND.md: objetos { valor, etiqueta }, sin sinClasificar
    tiposProveedor: [
      { valor: 'combustible', etiqueta: 'Combustible' }, { valor: 'material', etiqueta: 'Material' },
      { valor: 'vehiculo', etiqueta: 'Vehículo' }, { valor: 'estructura', etiqueta: 'Estructura' },
      { valor: 'herramienta', etiqueta: 'Herramienta' }, { valor: 'mixto', etiqueta: 'Mixto' },
      { valor: 'ignorar', etiqueta: 'Ignorar' },
    ],
    facturas: {
      [M]: [
        { id: 'd1', fecha: `${M}-04`, proveedor: 'BALLENOIL SA', tipo: 'combustible', importeSinIva: 82.31, matricula: null, numero: 'F-2026-1234' },
        { id: 'd2', fecha: `${M}-08`, proveedor: 'REPSOL', tipo: 'combustible', importeSinIva: 65.10, matricula: null, numero: 'R-0088' },
        { id: 'd3', fecha: `${M}-12`, proveedor: 'BALLENOIL SA', tipo: 'combustible', importeSinIva: 90.00, matricula: null, numero: 'F-2026-1301' },
        { id: 'd4', fecha: `${M}-02`, proveedor: 'CEPSA', tipo: 'combustible', importeSinIva: 70.00, matricula: '1111AAA', numero: 'C-0001' },
        { id: 'd5', fecha: `${M}-15`, proveedor: 'ELECTROSUR', tipo: 'material', importeSinIva: 300, matricula: null, numero: 'E-0005' },
        { id: 'd9#0', fecha: `${M}-05`, proveedor: 'RENTING EJEMPLO SL · Renting Citroën Berlingo 2222BBB', tipo: 'vehiculo', importeSinIva: 391.58, matricula: '2222BBB', numero: 'R-77' },
      ],
      [P]: [
        { id: 'd6', fecha: `${P}-10`, proveedor: 'CEPSA', tipo: 'combustible', importeSinIva: 120, matricula: '1111AAA', numero: 'C-0000' },
        { id: 'd7', fecha: `${P}-11`, proveedor: 'CEPSA', tipo: 'combustible', importeSinIva: 60, matricula: '2222BBB', numero: 'C-0002' },
      ],
    },
    sinClasificar: { [M]: [
      { id: 'd8', fecha: `${M}-10`, proveedor: 'GASOLINERA NUEVA SL', importeSinIva: 45.5, esLinea: false, numero: 'GN-311' },
      { id: 'd11', fecha: `${M}-14`, proveedor: 'FERRETERÍA EJEMPLO SA', importeSinIva: 90, esLinea: false, numero: 'FE-1022' },
      { id: 'd12', fecha: `${M}-18`, proveedor: 'FERRETERÍA EJEMPLO SA', importeSinIva: 34.2, esLinea: false, numero: 'FE-1057' },
      { id: 'd10#1', fecha: `${M}-11`, proveedor: 'TIENDA ONLINE SL · Cargador de baterías', importeSinIva: 29.9, esLinea: true, numero: 'TO-88' },
    ] },
    // Costes de empresa ya volcados por la gestoría, por mes: idTec → importe
    costes: { [P]: { T01: 2579.29, T02: 2310.4, T03: 2598.75, T06: 2490.1 } },
    excepciones: { [M]: [{ tipo: 'obra sin ejecutantes', detalle: 'E2631532 · 619,05 €' }] },
    motivos: ['Vacaciones', 'Asuntos propios', 'Permiso retribuido', 'Baja', 'Formación', 'Otros'],
    festivos: [
      [`${A}-01-01`, 'Año Nuevo', 'Nacional'], [`${A}-01-06`, 'Epifanía del Señor', 'Nacional'],
      [`${A}-04-02`, 'Jueves Santo', 'Comunidad de Madrid'], [`${A}-04-03`, 'Viernes Santo', 'Nacional'],
      [`${A}-05-01`, 'Fiesta del Trabajo', 'Nacional'], [`${A}-05-02`, 'Fiesta de la Comunidad de Madrid', 'Comunidad de Madrid'],
      [`${A}-05-15`, 'San Isidro', 'Local'], [`${A}-08-15`, 'Asunción de la Virgen', 'Nacional'],
      [`${A}-10-12`, 'Fiesta Nacional de España', 'Nacional'], [`${A}-11-01`, 'Todos los Santos', 'Nacional'],
      [`${A}-12-08`, 'Inmaculada Concepción', 'Nacional'], [`${A}-12-25`, 'Natividad del Señor', 'Nacional'],
    ].map(([fecha, nombre, ambito]) => ({ fecha, nombre, ambito })),
    // Régimen por unidad: Búfala 1 con contrato reducido desde el 09/09/2026 (BACKEND.md, encargo 4)
    parametros: [{ unidad: 'Búfala 1', desde: '2026-09-09', servicios: 1, jornada: 300, horario: '08:30-13:30', notas: 'Contrato reducido' }],
    // Precios de ejemplo (no son los de la hoja)
    precios: [
      { titulo: 'Cableado', conceptos: [
        { id: 'CAB-6', concepto: 'Cable 6 mm² (m)', coste: 1.35, notas: '' },
        { id: 'CAB-10', concepto: 'Cable 10 mm² (m)', coste: 2.2, notas: '' },
        { id: 'CAB-16', concepto: 'Cable 16 mm² (m)', coste: 3.4, notas: 'Precio de septiembre' } ] },
      { titulo: 'Protecciones', conceptos: [
        { id: 'PRO-MAG', concepto: 'Magnetotérmico 2P 40 A', coste: 14.9, notas: '' },
        { id: 'PRO-DIF', concepto: 'Diferencial 2P 40 A 30 mA tipo A', coste: 38.5, notas: '' },
        { id: 'PRO-SOB', concepto: 'Protector de sobretensiones', coste: 62, notas: '' } ] },
      { titulo: 'Canalización', conceptos: [
        { id: 'CAN-TUB', concepto: 'Tubo corrugado 25 mm (m)', coste: 0.42, notas: '' },
        { id: 'CAN-BAN', concepto: 'Bandeja 60×100 (m)', coste: 7.8, notas: '' } ] },
    ],
    ausencias: [
      // Las de Holded (id que empieza por H) llegan copiadas cada mañana y son de solo consulta
      { id: 'H1041', origen: 'holded', idTecnico: 'T01', desde: `${A}-08-03`, hasta: `${A}-08-14`, motivo: 'Vacaciones', notas: '' },
      { id: 'H1102', origen: 'holded', idTecnico: 'T02', desde: `${M}-07`, hasta: `${M}-11`, motivo: 'Vacaciones', notas: '' },
      { id: 'AU3', idTecnico: 'T03', desde: `${M}-16`, hasta: `${M}-16`, motivo: 'Asuntos propios', notas: '' },
      { id: 'AU4', idTecnico: 'T05', desde: `${M}-21`, hasta: `${M}-23`, motivo: 'Formación', notas: 'Curso de recarga VE' },
      { id: 'H0987', origen: 'holded', idTecnico: 'T02', desde: `${A}-07-20`, hasta: `${A}-07-31`, motivo: 'Vacaciones', notas: '' },
      // Como en la hoja real: un nombre escrito a mano que no casa con ningún empleado
      { id: 'AU6', idTecnico: null, tecnicoTexto: 'Javi G.', desde: `${M}-02`, hasta: `${M}-03`, motivo: 'Asuntos propios', notas: '' },
    ],
  };
}
let demo = null;

// Días laborables como el backend: de lunes a viernes, sin festivos (lista de ejemplo de la demostración)
const FESTIVOS_DEMO = ['01-01', '01-06', '05-01', '08-15', '10-12', '11-01', '12-06', '12-08', '12-25'];
function demoDiasLaborables(desde, hasta) {
  let n = 0;
  for (let d = new Date(desde + 'T12:00'); d <= new Date(hasta + 'T12:00'); d.setDate(d.getDate() + 1)) {
    const dia = d.getDay(), md = d.toISOString().slice(5, 10);
    if (dia !== 0 && dia !== 6 && !FESTIVOS_DEMO.includes(md)) n++;
  }
  return n;
}
function demoAusencia(a) {
  const t = demo.tecnicos.find(x => x.id === a.idTecnico);
  return { origen: 'manual', ...a, tecnico: t?.nombre || a.tecnicoTexto || a.idTecnico, equipo: (a.idTecnico && demoUnidadDe(a.idTecnico, a.desde)) || '', diasLaborables: demoDiasLaborables(a.desde, a.hasta) };
}

// Como el backend: facturas de combustible o vehículo sin matrícula ni ESTRUCTURA, desde mayo de 2026
function demoPendientes() {
  const DESDE = '2026-05';
  const porMes = [], sinClasificarPorMes = [];
  for (const [mes, lista] of Object.entries(demo.facturas).sort()) {
    if (mes < DESDE) continue;
    const sin = lista.filter(f => ['combustible', 'vehiculo'].includes(f.tipo) && !f.matricula);
    if (sin.length) porMes.push({ mes, n: sin.length, importeSinIva: Math.round(sin.reduce((t, f) => t + f.importeSinIva, 0) * 100) / 100 });
  }
  for (const [mes, lista] of Object.entries(demo.sinClasificar).sort()) if (mes >= DESDE && lista.length) sinClasificarPorMes.push({ mes, n: lista.length });
  return {
    desde: DESDE,
    sinAsignar: porMes.reduce((t, m) => t + m.n, 0),
    importeSinAsignar: Math.round(porMes.reduce((t, m) => t + m.importeSinIva, 0) * 100) / 100,
    porMes,
    sinClasificar: sinClasificarPorMes.reduce((t, m) => t + m.n, 0),
    sinClasificarPorMes,
  };
}

function demoUnidadDe(idTec, dia) {
  const a = demo.asignaciones.find(x => x.idTec === idTec && vig(x.desde, x.hasta, dia));
  return a ? demo.unidades.find(u => u.id === a.idUnidad)?.nombre || a.idUnidad : '';
}

// Filas de ejemplo para la liquidación. No es el cálculo real, que solo hace el backend.
function demoLiquidacion(mes) {
  const finMes = diaAntes(`${mesMas(mes, 1)}-01`);
  const costes = demo.costes[mes] || {};
  const ejemplo = [[18, 8420.5, 2110.3, 312.4, 'más de 3.000', 75], [15, 7300, 1850, 312.4, '2.500–3.000', 50],
    [12, 6100.25, 1600, 290, '2.000–2.500', 30], [9, 4200, 1100, 290, 'menos de 2.000', 0], [7, 3500, 900, 0, 'menos de 2.000', 0]];
  const diaRef = finMes < hoyIso() ? finMes : hoyIso();
  const computa = t => { const a = demo.asignaciones.find(x => x.idTec === t.id && vig(x.desde, x.hasta, diaRef)); return !a || demo.unidades.find(u => u.id === a.idUnidad)?.computaVariable !== false; };
  const filas = demo.tecnicos.filter(t => vigMes(t.alta, t.baja, mes) && computa(t)).map((t, i) => {
    const [obras, ingresos, material, costeVeh, tramo, importe] = ejemplo[i % ejemplo.length];
    const real = costes[t.id];
    const costeTec = real ?? 2450;
    return { idTec: t.id, nombre: t.nombre, unidad: demoUnidadDe(t.id, finMes < hoyIso() ? finMes : hoyIso()), obras,
      ingresos, material, costeTec, costeVeh, margen: Math.round((ingresos - material - costeTec - costeVeh) * 100) / 100,
      tramo, importe, origenCostes: real != null ? 'gestoria' : 'estimacion' };
  });
  return { ok: true, mes, estado: mes < hoyIso().slice(0, 7) ? 'cerrado' : 'abierto', filas,
    total: filas.reduce((s, f) => s + f.importe, 0), excepciones: demo.excepciones[mes] || [] };
}

function demoResponder(accion, params, p) {
  const conActivo = (lista, d, h) => lista.map(o => ({ ...o, activo: vig(o[d], o[h], hoyIso()) }));
  switch (accion) {
    case 'panelConfig':
      return { ok: true, tecnicos: conActivo(demo.tecnicos, 'alta', 'baja'), vehiculos: conActivo(demo.vehiculos, 'desde', 'hasta'),
        unidades: demo.unidades, asignaciones: demo.asignaciones, tramos: demo.tramos, ejercicio: demo.ejercicio, limites: demo.limites };
    case 'panelCompras':
      return { ok: true, mes: params.mes, facturas: demo.facturas[params.mes] || [], sinClasificar: demo.sinClasificar[params.mes] || [],
        tiposProveedor: demo.tiposProveedor, pendientes: demoPendientes(),
        tiposFactura: [...demo.tiposProveedor.filter(t => t.valor !== 'mixto'), { valor: 'materialUso', etiqueta: 'Material de uso (se reparte entre equipos)' }],
        equiposDisponibles: demo.unidades.filter(u => u.tipo !== 'no_productiva' && u.activa !== false).map(u => u.id),
        tiposConEquipos: ['herramienta', 'material', 'materialUso'] };
    case 'panelAusencias': {
      const lista = demo.ausencias.filter(a => (!params.hasta || a.desde <= params.hasta) && (!params.desde || a.hasta >= params.desde));
      return { ok: true, ausencias: lista.map(demoAusencia),
        tecnicos: demo.tecnicos.map(t => ({ id: t.id, nombre: t.nombre, unidad: demoUnidadDe(t.id, hoyIso()) || '', activo: !t.baja || t.baja >= hoyIso() })),
        motivos: demo.motivos };
    }
    case 'panelGuardarAusencia': {
      const deHolded = id => demo.ausencias.find(a => a.id === id)?.origen === 'holded';
      if (p.id && deHolded(p.id)) return { ok: false, error: 'Esta ausencia viene de Holded: cámbiala allí. Se actualiza aquí cada mañana.' };
      if (!p.idTecnico || !p.desde || !p.hasta || !p.motivo) return { ok: false, error: 'Faltan datos: técnico, desde, hasta y motivo.' };
      if (p.hasta < p.desde) return { ok: false, error: 'La fecha «hasta» no puede ser anterior a «desde».' };
      if (!demo.tecnicos.some(t => t.id === p.idTecnico)) return { ok: false, error: 'Ese técnico no está en la lista de ⚙️ Configuración.' };
      const choque = demo.ausencias.find(a => a.id !== p.id && a.idTecnico === p.idTecnico && a.desde <= p.hasta && a.hasta >= p.desde);
      if (choque) return { ok: false, error: `Se solapa con otra ausencia del mismo técnico: ${choque.motivo} del ${choque.desde} al ${choque.hasta}.` };
      const a = { origen: 'manual', id: p.id || 'AU' + (Math.max(0, ...demo.ausencias.filter(x => x.id.startsWith('AU')).map(x => Number(x.id.slice(2)) || 0)) + 1), idTecnico: p.idTecnico, desde: p.desde, hasta: p.hasta, motivo: p.motivo, notas: p.notas || '' };
      const i = demo.ausencias.findIndex(x => x.id === a.id);
      if (i >= 0) demo.ausencias[i] = a; else demo.ausencias.push(a);
      return { ok: true, accion, ausencia: demoAusencia(a), avisos: [] };
    }
    case 'panelBorrarAusencia':
      if (demo.ausencias.find(a => a.id === p.id)?.origen === 'holded') return { ok: false, error: 'Esta ausencia viene de Holded: anúlala allí. Se actualiza aquí cada mañana.' };
      demo.ausencias = demo.ausencias.filter(a => a.id !== p.id);
      return { ok: true, accion };
    case 'panelParametrosUnidades':
      return { ok: true, accion, porDefecto: { servicios: 2, jornada: 462 }, parametros: demo.parametros };
    case 'panelGuardarParametroUnidad': {
      if (!demo.unidades.some(u => u.id === p.unidad)) return { ok: false, error: `No existe la unidad «${p.unidad}».` };
      if (!p.desde) return { ok: false, error: 'Falta la fecha.' };
      if (p.borrar) { demo.parametros = demo.parametros.filter(x => !(x.unidad === p.unidad && x.desde === p.desde)); return { ok: true, accion, costesEnCola: true }; }
      if (!(p.servicios >= 0 && p.servicios <= 4) || !(p.jornada >= 1 && p.jornada <= 720)) return { ok: false, error: 'Servicios de 0 a 4 y jornada de 1 a 720 minutos.' };
      const parametro = { unidad: p.unidad, desde: p.desde, servicios: p.servicios, jornada: p.jornada, horario: p.horario || '', notas: p.notas || '' };
      demo.parametros = demo.parametros.filter(x => !(x.unidad === p.unidad && x.desde === p.desde)).concat(parametro);
      return { ok: true, accion, parametro, costesEnCola: true };
    }
    case 'panelFestivos':
      return { ok: true, accion, festivos: demo.festivos.filter(f => !params.anio || f.fecha.startsWith(String(params.anio))).sort((a, b) => a.fecha.localeCompare(b.fecha)) };
    case 'panelGuardarFestivo': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p.fecha || '') || !String(p.nombre || '').trim()) return { ok: false, error: 'Faltan la fecha o el nombre del festivo.' };
      if (demo.festivos.some(f => f.fecha === p.fecha && f.fecha !== p.fechaAnterior)) return { ok: false, error: `Ya hay un festivo el ${p.fecha}.` };
      const festivo = { fecha: p.fecha, nombre: String(p.nombre).trim(), ambito: String(p.ambito || '').trim() };
      demo.festivos = demo.festivos.filter(f => f.fecha !== (p.fechaAnterior || p.fecha)).concat(festivo);
      return { ok: true, accion, festivo };
    }
    case 'panelBorrarFestivo':
      demo.festivos = demo.festivos.filter(f => f.fecha !== p.fecha);
      return { ok: true, accion };
    case 'panelPrecios':
      return { ok: true, accion, familias: demo.precios };
    case 'panelGuardarPrecios': {
      const avisos = [];
      let guardados = 0;
      for (const c of p.cambios || []) {
        const x = demo.precios.flatMap(f => f.conceptos).find(k => k.id === c.id);
        if (!x) { avisos.push(`No existe el concepto ${c.id}: no se ha guardado.`); continue; }
        if (typeof c.coste === 'number') x.coste = c.coste;
        if (c.notas !== undefined) x.notas = c.notas;
        guardados++;
      }
      return { ok: true, accion, guardados, avisos };
    }
    case 'panelFacturaDetalle': {
      const f = Object.values(demo.facturas).flat().concat(Object.values(demo.sinClasificar).flat()).find(x => x.id === params.id);
      if (!f) return { ok: false, error: 'No existe esa factura.' };
      const base = f.importeSinIva;
      return { ok: true, factura: { id: f.id, numero: f.numero || '', proveedor: f.proveedor, fecha: f.fecha, subtotal: base, total: Math.round(base * 121) / 100, notas: 'Factura de ejemplo de la demostración.' },
        lineas: [{ concepto: 'Artículo de ejemplo', descripcion: f.proveedor, unidades: 1, precio: base, importe: base }],
        pdfError: 'En la demostración no hay PDF.' };
    }
    case 'panelClasificarFactura': {
      if (p.tipo === 'materialUso' && !(p.equipos || []).length) return { ok: false, error: 'Con «Material de uso» hay que elegir al menos un equipo.' };
      for (const [mes, lista] of Object.entries(demo.sinClasificar)) {
        const i = lista.findIndex(f => f.id === p.id);
        if (i >= 0) { const [f] = lista.splice(i, 1); (demo.facturas[mes] ||= []).push({ ...f, tipo: p.tipo, equipos: p.equipos || [], manual: true, matricula: null }); }
      }
      for (const lista of Object.values(demo.facturas)) {
        const f = lista.find(x => x.id === p.id);
        if (f) Object.assign(f, { tipo: p.tipo, equipos: p.equipos || [], manual: true });
      }
      return { ok: true, accion, id: p.id, tipo: p.tipo, equipos: p.equipos || [], avisos: [], costesEnCola: true };
    }
    case 'panelCostes':
      return { ok: true, desde: params.desde, hasta: params.hasta, costes: Object.entries(demo.costes)
        .filter(([m]) => m >= params.desde && m <= params.hasta)
        .flatMap(([m, c]) => Object.entries(c).map(([idTec, costeEmpresaMes]) => ({ mes: m, idTec, costeEmpresaMes, origen: 'gestoria' })))
        .concat(demo.tecnicos.filter(t => vig(t.alta, t.baja, `${params.hasta}-01`) && !demo.costes[params.hasta]?.[t.id])
          .map(t => ({ mes: params.hasta, idTec: t.id, costeEmpresaMes: 2400, origen: 'estimacion' }))) };
    case 'panelLiquidacion':
      return demoLiquidacion(params.mes);
    case 'panelGuardarConfig': {
      const nuevas = p.asignaciones || [];
      const ids = nuevas.filter(a => a.idTec && a.idUnidad).map(a => a.idTec);
      if (new Set(ids).size !== ids.length) return { ok: false, error: 'Un técnico aparece en dos unidades el mismo día.' };
      const poner = (lista, clave, o) => { const i = lista.findIndex(x => x[clave] === o[clave]); if (i >= 0) lista[i] = o; else lista.push(o); };
      // Las altas llegan sin id: lo asigna el backend y lo devuelve
      const asignados = { tecnicos: [], unidades: [] };
      const siguiente = (lista, pref, cifras) => pref + String(Math.max(0, ...lista.map(x => Number(String(x.id).replace(/\D/g, '')) || 0)) + 1).padStart(cifras, '0');
      for (const t of p.tecnicos || []) { if (!t.id) { t.id = siguiente(demo.tecnicos, 'T', 2); asignados.tecnicos.push(t.id); } poner(demo.tecnicos, 'id', t); }
      (p.vehiculos || []).forEach(v => poner(demo.vehiculos, 'matricula', v));
      // Como el backend, el id de una unidad nueva es su nombre (sin repetir)
      for (const u of p.unidades || []) {
        if (!u.id) {
          // Como el backend: el id es el nombre, no se repite, y computaVariable se deriva del nombre
          if (demo.unidades.some(x => x.id === u.nombre)) return { ok: false, rechazado: true, accion, error: `Ya existe la unidad «${u.nombre}».` };
          u.id = u.nombre; asignados.unidades.push(u.id);
          poner(demo.unidades, 'id', { tipo: 'productiva', activa: true, computaVariable: /^Búfala \d+$/.test(u.nombre), ...u });
          continue;
        }
        poner(demo.unidades, 'id', u);
      }
      for (const a of nuevas) {
        for (const v of demo.asignaciones) {
          const mismo = a.idTec ? v.idTec === a.idTec : (!v.idTec && v.idUnidad === a.idUnidad);
          if (mismo && vig(v.desde, v.hasta, a.desde)) v.hasta = diaAntes(a.desde);
        }
        if (a.idUnidad) demo.asignaciones.push(a);
      }
      return { ok: true, accion, avisos: [], ids: asignados };
    }
    case 'panelAsignarCombustible':
      for (const a of p.asignaciones || []) for (const lista of Object.values(demo.facturas)) {
        const f = lista.find(x => x.id === a.idFactura);
        if (f) f.matricula = a.matricula || null;
      }
      return { ok: true, accion };
    case 'panelClasificarProveedor':
      for (const [mes, lista] of Object.entries(demo.sinClasificar)) {
        const suyas = lista.filter(f => f.proveedor === p.proveedor);
        demo.sinClasificar[mes] = lista.filter(f => f.proveedor !== p.proveedor);
        (demo.facturas[mes] ||= []).push(...suyas.map(f => ({ ...f, tipo: p.tipo, matricula: null, numero: '' })));
      }
      return { ok: true, accion };
    case 'panelCostesTecnico':
      demo.costes[p.mes] = { ...(demo.costes[p.mes] || {}), ...Object.fromEntries((p.costes || []).map(c => [c.idTec, c.costeEmpresaMes])) };
      return { ok: true, accion };
  }
  return { ok: false, error: `La demostración no conoce la acción «${accion}».` };
}

async function demostracion(accion, { params = {}, cuerpo = null } = {}) {
  if (!demo) demo = crearDemo();
  await new Promise(r => setTimeout(r, 120));   // latencia simulada
  const r = copia(demoResponder(accion, params, copia(cuerpo ?? {})));
  if (r.ok === false) throw new ErrorApi(r.error, 'backend');
  return r;
}
