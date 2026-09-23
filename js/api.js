// Única capa que habla con el backend. Ningún otro módulo hace fetch.

// URL de la implementación activa de Apps Script. Es el único sitio donde se configura.
export const URL_BACKEND = 'https://script.google.com/macros/s/AKfycbxMMeyP9g75p1lxytithxeFfQVbe0cXV3aFHlJObfI05ewIN1mtTxPYBNPYp--BPKc9tw/exec';

// Acciones del panel que conoce esta interfaz.
export const TODAS = ['panelLogin', 'panelConfig', 'panelCompras', 'panelLiquidacion', 'panelCostes', 'panelGuardarConfig',
  'panelAsignarCombustible', 'panelClasificarProveedor', 'panelCostesTecnico'];

// Qué acciones van a producción lo dice el backend: GET ?action=ping devuelve
// { panel: true, accionesPanel: [...] }. Las que figuren ahí van a producción; el resto se
// sirve en modo demostración con los datos de ejemplo de más abajo. Así no hay que tocar
// este fichero cada vez que el backend añade una acción.
// Se pregunta una vez por carga de página; si falla, se vuelve a intentar en la siguiente llamada.
let esperaAcciones = null;
export function accionesEnProduccion() {
  if (!esperaAcciones) {
    esperaAcciones = aProduccion('ping', { conTestigo: false })
      .then(r => new Set(r.panel === true && Array.isArray(r.accionesPanel) ? r.accionesPanel.filter(a => TODAS.includes(a)) : []))
      .catch(e => { esperaAcciones = null; throw e; });
  }
  return esperaAcciones;
}

const CLAVE_TESTIGO = 'bufala-panel-testigo';
const ESPERA_MAX_MS = 60000;

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

// ── Transporte a producción ────────────────────────────
function esSesionCaducada(r) {
  const c = String(r.codigo || r.code || '').toLowerCase();
  return c === 'sesion' || c === 'sesion_caducada' || r.sesionCaducada === true;
}

async function aProduccion(accion, { metodo = 'GET', params = {}, cuerpo = null, conTestigo = true } = {}) {
  if (accion !== 'ping' && !(await accionesEnProduccion()).has(accion)) {
    throw new ErrorApi(`La acción «${accion}» no figura entre las implementadas en el backend.`, 'contrato');
  }
  const url = new URL(URL_BACKEND);
  const token = conTestigo ? testigoActual() : null;
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
  try {
    const resp = await fetch(url, opciones);
    texto = await resp.text();
  } catch (e) {
    avisarConexion(false, e.name === 'AbortError' ? 'El servidor tarda demasiado en responder.' : '');
    throw new ErrorApi(
      e.name === 'AbortError'
        ? 'El servidor no ha respondido a tiempo. Lo que has escrito sigue en pantalla: vuelve a intentarlo.'
        : 'No se puede contactar con el servidor. Comprueba la conexión; lo que has escrito sigue en pantalla.',
      'red');
  } finally {
    clearTimeout(temporizador);
  }

  let datos;
  try {
    datos = JSON.parse(texto);
  } catch {
    avisarConexion(true);
    throw new ErrorApi(`El servidor ha respondido a «${accion}» con algo que no es JSON.`, 'contrato');
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
  if (metodo !== 'GET' && accion !== 'panelLogin' && datos.accion !== accion) {
    throw new ErrorApi(`El servidor ha respondido a «${accion}» sin confirmarla. No se da por guardado.`, 'contrato');
  }
  return datos;
}

// Cada escritura con la lectura de la que depende. Una escritura solo se permite si va por el
// mismo camino que su lectura: así nunca se guarda en la demostración algo que se ha leído del
// sistema real, ni se envía al sistema real algo que se ha leído de la demostración.
const LECTURA_DE = {
  panelGuardarConfig: 'panelConfig',
  panelAsignarCombustible: 'panelCompras',
  panelClasificarProveedor: 'panelCompras',
  panelCostesTecnico: 'panelCostes',
};

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

export const leerConfig = () => llamar('panelConfig');
export const leerCompras = mes => llamar('panelCompras', { params: { mes } });
export const leerLiquidacion = mes => llamar('panelLiquidacion', { params: { mes } });
export const leerCostes = (desde, hasta) => llamar('panelCostes', { params: { desde, hasta } });

export const guardarConfig = cambios => llamar('panelGuardarConfig', { metodo: 'POST', cuerpo: cambios });
export const asignarCombustible = asignaciones => llamar('panelAsignarCombustible', { metodo: 'POST', cuerpo: { asignaciones } });
export const clasificarProveedor = (proveedor, tipo) => llamar('panelClasificarProveedor', { metodo: 'POST', cuerpo: { proveedor, tipo } });
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
      { id: 'T01', nombre: 'Antonio Ruiz', grupo: '3', alta: `${A}-01-01`, baja: null },
      { id: 'T02', nombre: 'Lucía Pérez', grupo: '2', alta: `${A}-02-01`, baja: null },
      { id: 'T03', nombre: 'Javier Gómez', grupo: '3', alta: `${A}-04-01`, baja: null },
      { id: 'T04', nombre: 'María López', grupo: '2', alta: `${A}-05-01`, baja: null },
      { id: 'T05', nombre: 'Pedro Sanz', grupo: '4', alta: `${A}-06-01`, baja: null },
      { id: 'T06', nombre: 'Elena Martín', grupo: '3', alta: `${A}-01-01`, baja: finP },
    ],
    vehiculos: [
      { matricula: '1111AAA', modelo: 'Renault Kangoo', rentingMes: 495.87, desde: `${A}-01-01`, hasta: null },
      { matricula: '2222BBB', modelo: 'Citroën Berlingo', rentingMes: 470, desde: `${A}-01-01`, hasta: null },
      { matricula: '3333CCC', modelo: 'Ford Transit', rentingMes: 520, desde: `${A}-03-01`, hasta: null },
    ],
    unidades: [
      { id: 'U1', nombre: 'Búfala 1', activa: true },
      { id: 'U2', nombre: 'Búfala 2', activa: true },
      { id: 'U3', nombre: 'Búfala 3', activa: true },
    ],
    asignaciones: [
      { idTec: 'T01', idUnidad: 'U1', matricula: '1111AAA', desde: `${A}-01-01`, hasta: finP },
      { idTec: 'T06', idUnidad: 'U1', matricula: '1111AAA', desde: `${A}-01-01`, hasta: finP },
      { idTec: 'T01', idUnidad: 'U1', matricula: '1111AAA', desde: `${M}-01`, hasta: null },
      { idTec: 'T02', idUnidad: 'U1', matricula: '1111AAA', desde: `${M}-01`, hasta: null },
      { idTec: 'T03', idUnidad: 'U2', matricula: '2222BBB', desde: `${M}-01`, hasta: null },
    ],
    tramos: [
      { desde: `${A}-01-01`, hasta: null, margenMin: 2000, margenMax: 2500, importe: 30 },
    ],
    ejercicio: { anio: Number(A), jornadaAnual: 1748, diasEfectivos: 227 },
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
      ],
      [P]: [
        { id: 'd6', fecha: `${P}-10`, proveedor: 'CEPSA', tipo: 'combustible', importeSinIva: 120, matricula: '1111AAA', numero: 'C-0000' },
        { id: 'd7', fecha: `${P}-11`, proveedor: 'CEPSA', tipo: 'combustible', importeSinIva: 60, matricula: '2222BBB', numero: 'C-0002' },
      ],
    },
    sinClasificar: { [M]: [{ id: 'd8', fecha: `${M}-10`, proveedor: 'GASOLINERA NUEVA SL', importeSinIva: 45.5 }] },
    // Costes de empresa ya volcados por la gestoría, por mes: idTec → importe
    costes: { [P]: { T01: 2579.29, T02: 2310.4, T03: 2598.75, T06: 2490.1 } },
    excepciones: { [M]: [{ tipo: 'obra sin ejecutantes', detalle: 'E2631532 · 619,05 €' }] },
  };
}
let demo = null;

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
  const filas = demo.tecnicos.filter(t => vigMes(t.alta, t.baja, mes)).map((t, i) => {
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
      return { ok: true, mes: params.mes, facturas: demo.facturas[params.mes] || [], sinClasificar: demo.sinClasificar[params.mes] || [], tiposProveedor: demo.tiposProveedor };
    case 'panelCostes':
      return { ok: true, desde: params.desde, hasta: params.hasta, costes: Object.entries(demo.costes)
        .filter(([m]) => m >= params.desde && m <= params.hasta)
        .flatMap(([m, c]) => Object.entries(c).map(([idTec, costeEmpresaMes]) => ({ mes: m, idTec, costeEmpresaMes, origen: 'gestoria' }))) };
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
      for (const u of p.unidades || []) { if (!u.id) { u.id = siguiente(demo.unidades, 'U', 1); asignados.unidades.push(u.id); } poner(demo.unidades, 'id', u); }
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
