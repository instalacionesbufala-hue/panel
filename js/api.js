// Única capa que habla con el backend. Ningún otro módulo hace fetch.

// URL de la implementación activa de Apps Script. Desde el encargo 9 el panel solo la usa para el ping
// (qué acciones están en producción); la página de la Dirección sigue hablando con ella directamente.
export const URL_BACKEND = 'https://script.google.com/macros/s/AKfycbxMMeyP9g75p1lxytithxeFfQVbe0cXV3aFHlJObfI05ewIN1mtTxPYBNPYp--BPKc9tw/exec';
// Supabase «panel-bufala» (BACKEND.md, encargo 9): acceso, lecturas publicadas (`vistas`) y el puente a Apps Script.
// La clave es la pública: va en el código por diseño; sin sesión no se lee ni se escribe nada.
export const URL_SUPABASE = 'https://yqdhvwnupdqyfifagmfx.supabase.co';
const CLAVE_PUBLICA = 'sb_publishable_zCv7-uFUpBrNFpSSJkJeWA_zdHmnM5k';
const MODULO_SUPABASE = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';

// Acciones del panel que conoce esta interfaz.
export const TODAS = ['panelLogin', 'panelConfig', 'panelCompras', 'panelLiquidacion', 'panelCostes', 'panelGuardarConfig',
  'panelAsignarCombustible', 'panelClasificarProveedor', 'panelCostesTecnico', 'panelFacturaDetalle', 'panelClasificarFactura',
  'panelAusencias', 'panelGuardarAusencia', 'panelBorrarAusencia',
  'panelFestivos', 'panelPrecios', 'panelGuardarPrecios',
  'panelParametrosUnidades', 'panelGuardarParametroUnidad'];
// Acciones de la página de la Dirección General (direccion.html): testigo propio, solo lectura.
export const TODAS_DIRECCION = ['direccionLogin', 'direccionIndicadores', 'direccionInforme'];

// Qué acciones van a producción lo dice el backend: GET ?action=ping devuelve
// { panel: true, accionesPanel: [...] }. Las que figuren ahí van a producción; el resto se
// sirve en modo demostración con los datos de ejemplo de más abajo. Así no hay que tocar
// este fichero cada vez que el backend añade una acción.
// El ping a Apps Script tarda 5-35 s, así que la última lista se recuerda en el navegador (solo nombres
// de acciones) y se usa al momento; la nueva llega por detrás y vale desde ese momento.
// Si el backend publica la fila `ping` en `vistas`, se lee de ahí; si no, se pregunta a Apps Script.
const CLAVE_ACCIONES = 'bufala-panel-acciones';
let esperaAcciones = null;
const filtrarAcciones = r => new Set(r && r.panel === true && Array.isArray(r.accionesPanel)
  ? r.accionesPanel.filter(a => TODAS.includes(a) || TODAS_DIRECCION.includes(a)) : []);
function accionesRecordadas() {
  try { const l = JSON.parse(localStorage.getItem(CLAVE_ACCIONES) || 'null'); return Array.isArray(l) ? new Set(l) : null; } catch { return null; }
}
function recordarAcciones(set) {
  try { localStorage.setItem(CLAVE_ACCIONES, JSON.stringify([...set])); } catch { /* sin almacenamiento: se pregunta en cada carga */ }
}
async function preguntarAcciones() {
  if (haySesionGuardada()) {
    const fila = await leerVista('ping').catch(() => null);
    if (fila) return filtrarAcciones(fila.datos);
  }
  return filtrarAcciones(await aAppsScript('ping', { conTestigo: false }));
}
export function accionesEnProduccion() {
  if (!esperaAcciones) {
    const recordadas = accionesRecordadas();
    const nuevas = preguntarAcciones();
    esperaAcciones = recordadas ? Promise.resolve(recordadas) : nuevas;
    nuevas.then(set => { recordarAcciones(set); esperaAcciones = Promise.resolve(set); },
      () => { if (!recordadas) esperaAcciones = null; });   // sin lista: se vuelve a preguntar en la siguiente llamada
  }
  return esperaAcciones;
}

// Si Google no contesta en 30 s o devuelve su página de error, se reintenta (solo lecturas).
const ESPERA_MAX_MS = 30000;
// El puente espera a Apps Script y reintenta él solo las lecturas: se le da más margen.
const ESPERA_PUENTE_MS = 90000;
// Lecturas: hasta 3 reintentos con 1-2 s de espera. Escrituras: ninguno a ciegas, para no duplicar un guardado.
const REINTENTOS_LECTURA = 3;
const pausaReintento = () => new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));

export class ErrorApi extends Error {
  // tipo: 'red' (no hay conexión), 'contrato' (respuesta que no cumple el contrato),
  //       'backend' (el backend rechaza), 'bloqueado' (demasiados intentos), 'sesion' (hay que volver a entrar),
  //       'permiso' (el usuario no tiene acceso al panel)
  constructor(mensaje, tipo) {
    super(mensaje);
    this.tipo = tipo;
  }
}

// ── Sesión (Supabase Auth) ─────────────────────────────
// La guarda y la renueva supabase-js. Va en localStorage (encargo 10): se recuerda entre pestañas y días
// hasta «Cerrar sesión» o hasta que Supabase la anule; entonces se vuelve a pedir el acceso.
const CLAVE_SESION = 'bufala-panel-sesion';
const memoria = new Map();
const almacenSesion = {
  getItem: k => { try { return localStorage.getItem(k); } catch { return memoria.get(k) ?? null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { memoria.set(k, v); } },
  removeItem: k => { try { localStorage.removeItem(k); } catch { /* nada */ } memoria.delete(k); },
};
const haySesionGuardada = () => !!almacenSesion.getItem(CLAVE_SESION);

let clienteSupabase = null;
function supabase() {
  if (!clienteSupabase) {
    clienteSupabase = import(MODULO_SUPABASE)
      .then(({ createClient }) => createClient(URL_SUPABASE, CLAVE_PUBLICA, {
        auth: { storage: almacenSesion, storageKey: CLAVE_SESION, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      }))
      .catch(() => {
        clienteSupabase = null;
        throw new ErrorApi('No se ha podido cargar el acceso al panel. Comprueba la conexión y recarga la página.', 'red');
      });
  }
  return clienteSupabase;
}
async function sesionActual() {
  if (!haySesionGuardada()) return null;   // sin sesión no hace falta ni cargar supabase-js
  const { data } = await (await supabase()).auth.getSession();   // la renueva si ha caducado
  return data?.session || null;
}
export async function haySesion() {
  try { return !!(await sesionActual()); } catch { return false; }
}
export async function cerrarSesion() {
  try { if (haySesionGuardada()) await (await supabase()).auth.signOut(); } catch { /* nada */ }
  almacenSesion.removeItem(CLAVE_SESION);
  // Restos de antes: la sesión en sessionStorage (v29-30) y el testigo de Apps Script
  try { sessionStorage.removeItem(CLAVE_SESION); sessionStorage.removeItem('bufala-panel-testigo'); } catch { /* nada */ }
}

// La aplicación registra aquí cómo pedir el acceso. Devuelve una promesa
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
// De cuándo son los datos que se acaban de leer: { accion, actualizado } (ISO; null = al momento, por el puente)
const oyentesFrescura = new Set();
export function alLeerDatos(fn) { oyentesFrescura.add(fn); }
const avisarFrescura = (accion, actualizado) => oyentesFrescura.forEach(fn => fn({ accion, actualizado }));

// ── Transporte a producción ────────────────────────────
function esSesionCaducada(r) {
  const c = String(r.codigo || r.code || '').toLowerCase();
  return c === 'sesion' || c === 'sesion_caducada' || r.sesionCaducada === true;
}

// Apps Script atiende una sola ejecución a la vez: las peticiones simultáneas se encolan en Google y la
// última puede pasarse de tiempo (BACKEND.md v3.20.18). Por eso lo que acaba en Apps Script sale de uno en uno:
// una cola para el puente del panel y otra para lo que va directo (ping y Dirección), para que el ping, que va
// por detrás, no retrase a la pantalla. Las lecturas de `vistas` no pasan por Apps Script y no hacen cola.
function crearCola() {
  let cola = Promise.resolve();
  return tarea => {
    const turno = cola.then(tarea, tarea);
    cola = turno.catch(() => {});
    return turno;
  };
}
const enColaPuente = crearCola();
const enColaDirecta = crearCola();
const aAppsScript = (accion, opciones = {}) => enColaDirecta(() => conReintento(accion, opciones, enviarAProduccion));

// Reintentos solo para fallos de Google o de red (sin respuesta, página de error, más de 30 s), y solo en
// lecturas. Un «no» del backend (ok:false) nunca se repite. La franja de conexión solo sale cuando ya no
// quedan intentos. Con el servidor ocupado, Google contesta a veces con su página de error (HTML, a veces un
// 404 de script.googleusercontent.com) y el navegador lo ve como «Failed to fetch».
async function conReintento(accion, opciones, enviar) {
  const lectura = (opciones.metodo || 'GET') === 'GET';
  for (let intento = 0; ; intento++) {
    try {
      return await enviar(accion, opciones);
    } catch (e) {
      if (!e.reintentable) throw e;
      if (lectura && intento < REINTENTOS_LECTURA) {
        if (intento === 0) oyentesReintento.forEach(fn => fn(accion));
        await pausaReintento();
        continue;
      }
      if (e.tipo === 'red') avisarConexion(false, e.detalleConexion || '');
      if (!lectura) throw escrituraSinRespuesta(e);
      throw e;
    }
  }
}
// En una escritura no se sabe si llegó a guardarse: no se repite sola y se dice qué hacer
function escrituraSinRespuesta(e) {
  const err = new ErrorApi(e.tiempoAgotado
    ? 'El servidor no ha contestado a tiempo. Puede que se haya guardado: recarga la pantalla antes de volver a intentarlo.'
    : 'El servidor está ocupado, vuelve a intentarlo en unos segundos.', e.tipo);
  err.reintentable = false;
  err.sinConfirmar = !!e.tiempoAgotado;
  return err;
}
function errorDeRed(e, ms) {
  const err = new ErrorApi(
    e.name === 'AbortError'
      ? 'El servidor no ha respondido a tiempo, ni al reintentarlo. Lo que has escrito sigue en pantalla: vuelve a intentarlo en un minuto.'
      : 'No se puede contactar con el servidor, ni al reintentarlo. Si tienes conexión, suele ser un fallo momentáneo: espera un minuto y vuelve a intentarlo. Lo que has escrito sigue en pantalla.',
    'red');
  err.reintentable = true;
  err.tiempoAgotado = e.name === 'AbortError';
  err.detalleConexion = e.name === 'AbortError' ? `El servidor tarda más de ${Math.round(ms / 1000)} s en responder.` : '';
  return err;
}

// Lo que se comprueba en toda respuesta, venga de Apps Script, del puente o de `vistas`
function validar(accion, datos, metodo) {
  if (datos && datos.ok === false) {
    const codigo = String(datos.codigo || '').toLowerCase();
    if (esSesionCaducada(datos)) throw new ErrorApi(datos.error || 'La sesión ha caducado.', 'sesion');
    if (codigo === 'permiso') throw new ErrorApi('Tu usuario no tiene acceso al panel.', 'permiso');
    if (codigo === 'ocupado') {
      // El puente ya ha reintentado las lecturas; los guardados no se repiten. En un guardado, el puente no
      // sabe si Apps Script llegó a aplicarlo (a veces termina bien y su respuesta se pierde): puedeHaberseGuardado.
      const err = new ErrorApi(datos.puedeHaberseGuardado
        ? 'El servidor no ha confirmado el guardado. Puede que se haya guardado: recarga la pantalla antes de volver a intentarlo.'
        : 'El servidor está ocupado, vuelve a intentarlo en unos segundos.', 'backend');
      err.reintentable = false;
      err.sinConfirmar = !!datos.puedeHaberseGuardado;
      throw err;
    }
    if (datos.rechazado) throw new ErrorApi(datos.error || `El servidor no admite la acción «${accion}».`, 'contrato');
    if (datos.bloqueado) throw new ErrorApi(datos.error || 'Demasiados intentos fallidos: el acceso está bloqueado temporalmente.', 'bloqueado');
    throw new ErrorApi(datos.error || 'El servidor ha rechazado la operación sin indicar el motivo.', 'backend');
  }
  if (!datos || datos.ok !== true) throw new ErrorApi(`Respuesta inesperada del servidor en «${accion}».`, 'contrato');
  // En las escrituras (salvo el acceso, que se valida por el testigo) el backend debe repetir la acción
  if (metodo !== 'GET' && accion !== 'panelLogin' && accion !== 'direccionLogin' && datos.accion !== accion && datos.simulacion !== true) {
    throw new ErrorApi(`El servidor ha respondido a «${accion}» sin confirmarla. No se da por guardado.`, 'contrato');
  }
  // Los guardados contestan enseguida y dejan el recálculo de costes en cola (1-2 minutos)
  if (datos.costesEnCola) oyentesCostesEnCola.forEach(fn => fn(accion));
  return datos;
}
function respuestaNoJson(accion, texto, inicio) {
  avisarConexion(true);
  const segundos = Math.round((Date.now() - inicio) / 1000);
  const err = new ErrorApi(`El servidor ha fallado al responder a «${accion}» (tras ${segundos} s)${motivoPaginaError(texto)}, también al reintentarlo. `
    + 'No es un fallo del panel: hay que avisar al backend. Puedes volver a intentarlo.', 'backend');
  err.reintentable = true;
  return err;
}

// Directo a Apps Script: el ping y la página de la Dirección
async function enviarAProduccion(accion, { metodo = 'GET', params = {}, cuerpo = null, testigoExplicito = null } = {}) {
  const url = new URL(URL_BACKEND);
  const token = testigoExplicito;   // el de la Dirección; el panel ya no usa testigo de Apps Script
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
    throw errorDeRed(e, ESPERA_MAX_MS);
  } finally {
    clearTimeout(temporizador);
  }

  let datos;
  try { datos = JSON.parse(texto); } catch { throw respuestaNoJson(accion, texto, inicio); }
  avisarConexion(true);
  return validar(accion, datos, metodo);
}

// Por el puente de Supabase (panel-puente): guardados y lecturas no publicadas. Devuelve la respuesta de Apps Script tal cual.
async function enviarAlPuente(accion, { metodo = 'GET', params = {}, cuerpo = null } = {}) {
  const sesion = await sesionActual();
  if (!sesion) throw new ErrorApi('La sesión ha caducado.', 'sesion');
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), ESPERA_PUENTE_MS);
  const inicio = Date.now();
  let resp, texto;
  try {
    resp = await fetch(`${URL_SUPABASE}/functions/v1/panel-puente`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sesion.access_token, apikey: CLAVE_PUBLICA },
      body: JSON.stringify(metodo === 'GET' ? { metodo, accion, params } : { metodo, accion, cuerpo: cuerpo ?? {} }),
      signal: control.signal,
    });
    texto = await resp.text();
  } catch (e) {
    const err = errorDeRed(e, ESPERA_PUENTE_MS);
    // El puente ya ha esperado a Google y reintentado: si se agota el tiempo, no se repite
    if (err.tiempoAgotado) err.reintentable = metodo !== 'GET' ? true : false;
    throw err;
  } finally {
    clearTimeout(temporizador);
  }
  let datos;
  try { datos = JSON.parse(texto); } catch {
    if (resp.status === 401) throw new ErrorApi('La sesión ha caducado.', 'sesion');
    throw respuestaNoJson(accion, texto, inicio);
  }
  avisarConexion(true);
  if (resp.status === 401 && datos?.ok !== false) throw new ErrorApi('La sesión ha caducado.', 'sesion');
  return validar(accion, datos, metodo);
}

// ── Lecturas publicadas en Supabase (tabla `vistas`) ───
// `datos` es la respuesta exacta de doGet. Clave = acción y sus parámetros, como en BACKEND.md.
function claveVista(accion, params = {}) {
  switch (accion) {
    case 'panelConfig': case 'panelPrecios': case 'panelParametrosUnidades': return accion;
    case 'panelCompras': case 'panelLiquidacion': return params.mes ? `${accion}:${params.mes}` : null;
    case 'panelCostes': case 'panelAusencias': return params.desde && params.hasta ? `${accion}:${params.desde}:${params.hasta}` : null;
    case 'panelFestivos': return params.anio ? `${accion}:${params.anio}` : null;
    default: return null;
  }
}
// null si la fila no está (un mes antiguo, otro rango) o si Supabase falla: entonces se lee por el puente
async function leerVista(clave) {
  const sb = await supabase();
  let r;
  try { r = await sb.from('vistas').select('datos, actualizado').eq('clave', clave).maybeSingle(); } catch { return null; }
  if (r.error) {
    if (r.status === 401 || /jwt/i.test(r.error.message || '')) throw new ErrorApi('La sesión ha caducado.', 'sesion');
    return null;
  }
  return r.data && r.data.datos && r.data.datos.ok === true ? r.data : null;
}

// Tras un guardado, la pantalla afectada se lee por el puente durante 5 minutos: así se ve el cambio al
// momento mientras el backend vuelve a publicar la vista (tarda 2-3 minutos, con el recálculo).
const VENTANA_PUENTE_MS = 5 * 60 * 1000;
const guardadoEn = new Map();   // lectura → hora del último guardado que la afecta
const recienGuardada = accion => Date.now() - (guardadoEn.get(accion) || 0) < VENTANA_PUENTE_MS;

async function aProduccion(accion, opciones = {}) {
  if (!(await accionesEnProduccion()).has(accion)) {
    throw new ErrorApi(`La acción «${accion}» no figura entre las implementadas en el backend.`, 'contrato');
  }
  const metodo = opciones.metodo || 'GET';
  const inicio = performance.now();
  const clave = metodo === 'GET' ? claveVista(accion, opciones.params) : null;
  if (clave && !recienGuardada(accion)) {
    const fila = await leerVista(clave);
    if (fila) {
      console.info(`[panel] ${clave} · vista · ${Math.round(performance.now() - inicio)} ms`);
      avisarFrescura(accion, fila.actualizado || null);
      return validar(accion, fila.datos, 'GET');
    }
  }
  const datos = await enColaPuente(() => conReintento(accion, opciones, enviarAlPuente));
  console.info(`[panel] ${accion} · puente · ${Math.round(performance.now() - inicio)} ms`);
  if (metodo === 'GET') avisarFrescura(accion, null);
  else if (LECTURA_DE[accion] && !opciones.cuerpo?.simular) guardadoEn.set(LECTURA_DE[accion], Date.now());
  return datos;
}

// Cada escritura con la lectura de la que depende. Una escritura solo se permite si va por el
// mismo camino que su lectura: así nunca se guarda en la demostración algo que se ha leído del
// sistema real, ni se envía al sistema real algo que se ha leído de la demostración.
// Es también el mapa de qué pantalla se lee por el puente tras un guardado.
const LECTURA_DE = {
  panelGuardarConfig: 'panelConfig',
  panelAsignarCombustible: 'panelCompras',
  panelClasificarProveedor: 'panelCompras',
  panelClasificarFactura: 'panelCompras',
  panelCostesTecnico: 'panelCostes',
  panelGuardarAusencia: 'panelAusencias',
  panelBorrarAusencia: 'panelAusencias',
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

// Si la sesión caduca, se pide el acceso encima de la vista y se repite la llamada.
async function llamar(accion, opciones) {
  if (!(await haySesion())) await pedirAcceso('Introduce tu correo y tu contraseña.');
  try {
    return await peticion(accion, opciones);
  } catch (e) {
    if (e.tipo !== 'sesion') throw e;
    await cerrarSesion();
    await pedirAcceso('La sesión ha caducado. Vuelve a entrar; no se ha perdido nada de lo que estabas haciendo.');
    return peticion(accion, opciones);
  }
}

// ── Acciones del contrato ──────────────────────────────
// Acceso con el usuario de Supabase (sustituye a panelLogin). Nunca se simula.
export async function entrar(correo, clave) {
  const sb = await supabase();
  const { data, error } = await sb.auth.signInWithPassword({ email: String(correo || '').trim(), password: clave });
  if (error) {
    if (error.status === 400 || /invalid/i.test(error.message || '')) throw new ErrorApi('Correo o contraseña incorrectos.', 'backend');
    if (error.status === 429) throw new ErrorApi('Demasiados intentos: espera unos minutos antes de volver a probar.', 'bloqueado');
    throw new ErrorApi('No se ha podido comprobar el acceso. Comprueba la conexión y vuelve a intentarlo.', 'red');
  }
  if (!data?.session) throw new ErrorApi('El servidor no ha abierto la sesión.', 'contrato');
  // Sin lista recordada (primera visita en este navegador), se pregunta ya, ahora a la fila `ping` de `vistas`
  if (!accionesRecordadas()) esperaAcciones = null;
  accionesEnProduccion();
  return data;
}

// panelConfig: se guarda una copia en memoria (nunca en el navegador) y se
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
// Alta completa de equipos (Panel Config v1.7.0): el mismo cuerpo con simular: true → { ok, simulacion, plan, error? } sin escribir
export const simularConfig = cambios => llamar('panelGuardarConfig', { metodo: 'POST', cuerpo: { ...cambios, simular: true } });
export const asignarCombustible = asignaciones => llamar('panelAsignarCombustible', { metodo: 'POST', cuerpo: { asignaciones } });
// todas: true (Panel_Compras v1.18) = el tipo pasa al proveedor y a TODAS sus facturas, también las clasificadas a mano.
// Vale desde el proveedor o desde una de sus líneas «Proveedor · texto». No admite «mixto» ni «materialUso».
export const clasificarProveedor = (proveedor, tipo, todas = false) =>
  llamar('panelClasificarProveedor', { metodo: 'POST', cuerpo: { proveedor, tipo, ...(todas ? { todas: true } : {}) } });
// Ausencias (BACKEND.md, encargo del 26/09/2026). Sin id = alta; con id = edición.
export const leerAusencias = (desde, hasta) => llamar('panelAusencias', { params: { desde, hasta } });
export const guardarAusencia = a => llamar('panelGuardarAusencia', { metodo: 'POST', cuerpo: a });
export const borrarAusencia = id => llamar('panelBorrarAusencia', { metodo: 'POST', cuerpo: { id } });

// Régimen de cada unidad (encargo 4): servicios/día y jornada con fecha. Con borrar: true se elimina esa fila.
export const leerParametrosUnidades = () => llamar('panelParametrosUnidades');
export const guardarParametroUnidad = p => llamar('panelGuardarParametroUnidad', { metodo: 'POST', cuerpo: p });

// Configuración (encargo 3 del 26/09/2026): festivos y precios de coste de material.
// Festivos: solo consulta (se gestionan en Holded, v3.20.40). Precios: solo coste y notas; id y concepto no se tocan.
export const leerFestivos = anio => llamar('panelFestivos', { params: { anio } });
export const leerPrecios = () => llamar('panelPrecios');
export const guardarPrecios = cambios => llamar('panelGuardarPrecios', { metodo: 'POST', cuerpo: { cambios } });

// Dirección General: va a producción solo si el ping la anuncia; su testigo lo guarda direccion.js.
// Usa la misma cola y el mismo reintento que el panel. Nunca se simula aquí: la demostración la pone direccion.js.
export async function peticionDireccion(accion, { metodo = 'GET', params = {}, cuerpo = null, testigo = null } = {}) {
  if (!TODAS_DIRECCION.includes(accion)) throw new ErrorApi(`Acción desconocida: ${accion}`, 'contrato');
  if (!(await accionesEnProduccion()).has(accion)) throw new ErrorApi('Esta parte todavía no está activada en el servidor.', 'no-disponible');
  return enColaDirecta(() => conReintento(accion, { metodo, params, cuerpo, testigoExplicito: testigo }, enviarAProduccion));
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
      { id: 'T01', nombre: 'Luis Martín', rol: 'Instalador', grupo: null, alta: null, baja: null, correo: 'luis.martin@ejemplo.test' },
      { id: 'T02', nombre: 'Andrea Pardo', rol: 'Instalador', grupo: null, alta: `${A}-02-01`, baja: null, correo: 'andrea.pardo@ejemplo.test' },
      { id: 'T03', nombre: 'Jorge Ruiz', rol: 'Instalador', grupo: null, alta: `${A}-04-01`, baja: null, correo: null },
      { id: 'T04', nombre: 'Marta Gil', rol: 'Instalador', grupo: null, alta: `${A}-05-01`, baja: null, correo: null },
      { id: 'T05', nombre: 'Sergio Molina', rol: 'SAT', grupo: null, alta: `${A}-06-01`, baja: null },
      { id: 'T06', nombre: 'Raúl Ortega', rol: 'Instalador', grupo: null, alta: `${A}-01-01`, baja: finP },
      { id: 'T07', nombre: 'Laura Vega', rol: 'Gerencia', grupo: null, alta: `${A}-01-01`, baja: null },
    ],
    vehiculos: [
      { matricula: '1111AAA', sinMatricula: false, modelo: 'Renault Kangoo', brigada: 'Búfala 1', rentingMes: 480, desde: null, hasta: null },
      { matricula: '2222BBB', sinMatricula: false, modelo: 'Citroën Berlingo', brigada: 'Búfala 2', rentingMes: 460, desde: null, hasta: null },
      { matricula: '3333CCC', sinMatricula: false, modelo: 'Ford Transit', brigada: 'Búfala 3', rentingMes: 500, desde: `${A}-03-01`, hasta: null },
      { matricula: '4444DDD', sinMatricula: false, modelo: 'Toyota Corolla', brigada: 'Gerencia', rentingMes: 400, desde: `${A}-06-01`, hasta: null },
      { matricula: 'REC-017', sinMatricula: true, modelo: 'Furgoneta SAT', brigada: 'SAT', rentingMes: 300, desde: null, hasta: null },
    ],
    unidades: [
      // Los id son los nombres de brigada de la hoja (cadenas opacas); nombre es solo para mostrar
      { id: 'Búfala 1', nombre: 'Búfala 1', tipo: 'productiva', computaVariable: true, activa: true,
        equipo: { fila: 4, color: 9, calendarioId: 'demo-bufala1@group.calendar.google.com', salidaKm: 'Calle Ficticia 1, 28000 Madrid', saltoki: 'LEGANES', naveDesde: null } },
      { id: 'Búfala 2', nombre: 'Búfala 2', tipo: 'productiva', computaVariable: true, activa: true,
        equipo: { fila: 5, color: 2, calendarioId: 'demo-bufala2@group.calendar.google.com', salidaKm: 'Avenida Inventada 22, 28100 Alcobendas', saltoki: 'ALCOBENDAS', naveDesde: `${A}-03-01` } },
      { id: 'Búfala 3', nombre: 'Búfala 3', tipo: 'productiva', computaVariable: true, activa: true,
        equipo: { fila: 6, color: 6, calendarioId: 'demo-bufala3@group.calendar.google.com', salidaKm: '', saltoki: 'LEGANES', naveDesde: null } },
      { id: 'Gerencia', nombre: 'Estructura', tipo: 'no_productiva', computaVariable: false, activa: true, equipo: null },
      { id: 'SAT', nombre: 'SAT', tipo: 'no_productiva', computaVariable: false, activa: true, equipo: null },
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
    limites: { tecnicosPorUnidad: 3, tecnicosCompleta: 2 },
    // Forma de BACKEND.md: objetos { valor, etiqueta }, sin sinClasificar
    tiposProveedor: [
      { valor: 'combustible', etiqueta: 'Combustible' }, { valor: 'material', etiqueta: 'Material' },
      { valor: 'vehiculo', etiqueta: 'Vehículo' }, { valor: 'estructura', etiqueta: 'Estructura' },
      { valor: 'herramienta', etiqueta: 'Herramienta' }, { valor: 'mixto', etiqueta: 'Mixto' },
      { valor: 'ignorar', etiqueta: 'Ignorar' },
    ],
    facturas: {
      [M]: [
        { id: 'd1', fecha: `${M}-04`, proveedor: 'GASOLINERA EJEMPLO SA', tipo: 'combustible', importeSinIva: 80, matricula: null, numero: 'F-2026-1234' },
        { id: 'd2', fecha: `${M}-08`, proveedor: 'ESTACIÓN DE SERVICIO DEMO', tipo: 'combustible', importeSinIva: 65, matricula: null, numero: 'R-0088' },
        { id: 'd3', fecha: `${M}-12`, proveedor: 'GASOLINERA EJEMPLO SA', tipo: 'combustible', importeSinIva: 90.00, matricula: null, numero: 'F-2026-1301' },
        { id: 'd4', fecha: `${M}-02`, proveedor: 'CARBURANTES DEMO SL', tipo: 'combustible', importeSinIva: 70.00, matricula: '1111AAA', numero: 'C-0001' },
        { id: 'd5', fecha: `${M}-15`, proveedor: 'MATERIAL ELÉCTRICO EJEMPLO SL', tipo: 'material', importeSinIva: 300, matricula: null, numero: 'E-0005' },
        { id: 'd9#0', fecha: `${M}-05`, proveedor: 'RENTING EJEMPLO SL · Renting Citroën Berlingo 2222BBB', tipo: 'vehiculo', importeSinIva: 380, matricula: '2222BBB', numero: 'R-77' },
      ],
      [P]: [
        { id: 'd6', fecha: `${P}-10`, proveedor: 'CARBURANTES DEMO SL', tipo: 'combustible', importeSinIva: 120, matricula: '1111AAA', numero: 'C-0000' },
        { id: 'd7', fecha: `${P}-11`, proveedor: 'CARBURANTES DEMO SL', tipo: 'combustible', importeSinIva: 60, matricula: '2222BBB', numero: 'C-0002' },
      ],
    },
    sinClasificar: { [M]: [
      { id: 'd8', fecha: `${M}-10`, proveedor: 'GASOLINERA NUEVA SL', importeSinIva: 45.5, esLinea: false, numero: 'GN-311' },
      { id: 'd11', fecha: `${M}-14`, proveedor: 'FERRETERÍA EJEMPLO SA', importeSinIva: 90, esLinea: false, numero: 'FE-1022' },
      { id: 'd12', fecha: `${M}-18`, proveedor: 'FERRETERÍA EJEMPLO SA', importeSinIva: 34.2, esLinea: false, numero: 'FE-1057' },
      { id: 'd10#1', fecha: `${M}-11`, proveedor: 'TIENDA ONLINE SL · Cargador de baterías', importeSinIva: 29.9, esLinea: true, numero: 'TO-88' },
    ] },
    // Costes de empresa ya volcados por la gestoría, por mes: idTec → importe
    costes: { [P]: { T01: 2400, T02: 2300, T03: 2500, T06: 2350 } },
    excepciones: { [M]: [{ tipo: 'obra sin ejecutantes', detalle: 'E0000001 · 600,00 €' }] },
    motivos: ['Vacaciones', 'Asuntos propios', 'Permiso retribuido', 'Baja', 'Formación', 'Otros'],
    festivos: [
      [`${A}-01-01`, 'Año Nuevo', 'Nacional'], [`${A}-01-06`, 'Epifanía del Señor', 'Nacional'],
      [`${A}-04-02`, 'Jueves Santo', 'Comunidad de Madrid'], [`${A}-04-03`, 'Viernes Santo', 'Nacional'],
      [`${A}-05-01`, 'Fiesta del Trabajo', 'Nacional'], [`${A}-05-02`, 'Fiesta de la Comunidad de Madrid', 'Comunidad de Madrid'],
      [`${A}-05-15`, 'San Isidro', 'Local'], [`${A}-08-15`, 'Asunción de la Virgen', 'Nacional'],
      [`${A}-10-12`, 'Fiesta Nacional de España', 'Nacional'], [`${A}-11-01`, 'Todos los Santos', 'Nacional'],
      [`${A}-12-08`, 'Inmaculada Concepción', 'Nacional'], [`${A}-12-25`, 'Natividad del Señor', 'Nacional'],
      [`${A}-11-09`, 'Nuestra Señora de la Almudena', 'Holded'],
    ].map(([fecha, nombre, ambito]) => ({ fecha, nombre, ambito })),
    // Régimen por unidad (ejemplo inventado)
    parametros: [{ unidad: 'Búfala 3', desde: `${A}-01-15`, servicios: 1, jornada: 300, horario: '09:00-14:00', notas: 'Ejemplo' }],
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
      // Un nombre escrito a mano que no casa con ningún empleado
      { id: 'AU6', idTecnico: null, tecnicoTexto: 'Jorge R.', desde: `${M}-02`, hasta: `${M}-03`, motivo: 'Asuntos propios', notas: '' },
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
  const u = a.idTecnico && demoUnidadDe(a.idTecnico, a.desde);
  const brigada = u && demo.unidades.find(x => x.id === u)?.tipo !== 'no_productiva' ? u : '';
  return { origen: 'manual', ...a, tecnico: t?.nombre || a.tecnicoTexto || a.idTecnico, equipo: brigada, diasLaborables: demoDiasLaborables(a.desde, a.hasta) };
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
  if (mes >= '2026-10') return demoLiquidacion21(mes);
  const finMes = diaAntes(`${mesMas(mes, 1)}-01`);
  const costes = demo.costes[mes] || {};
  const ejemplo = [[18, 8400, 2100, 300, 'más de 3.000', 75], [15, 7300, 1850, 300, '2.500–3.000', 50],
    [12, 6100, 1600, 290, '2.000–2.500', 30], [9, 4200, 1100, 290, 'menos de 2.000', 0], [7, 3500, 900, 0, 'menos de 2.000', 0]];
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

// Variable v2.1: por técnico y día. Cifras inventadas, solo para ver la pantalla.
function demoLiquidacion21(mes) {
  const tramo = r => r < 2000 ? 0 : r > 3000 ? 75 : Math.round((30 + 0.045 * (r - 2000)) * 100) / 100;
  const ej = [[{ 'Búfala 1': 19 }, 19, 9800, 2300, 420, 2450, 380, 'gestoria'], [{ 'Búfala 1': 12, 'Búfala 2': 6 }, 18, 8900, 2100, 400, 2380, 310, 'gestoria'],
    [{ 'Búfala 2': 17 }, 17, 7600, 1900, 380, 2400, 450, 'estimacion'], [{ 'Búfala 3': 10 }, 10, 3900, 1000, 220, 0, 120, 'sin coste']];
  const tecs = demo.tecnicos.filter(t => vigMes(t.alta, t.baja, mes) && !['SAT', 'Gerencia'].includes(t.rol));
  const filas = tecs.slice(0, ej.length).map((t, i) => {
    const [unidades, dias, ingresos, material, costeVeh, costeTec, descargos, origenCostes] = ej[i];
    const rentabilidad = Math.round((ingresos - material - costeVeh - costeTec - descargos) * 100) / 100;
    return { idTec: t.id, nombre: t.nombre, unidad: Object.keys(unidades)[0], unidades, diasTrabajados: dias, ingresos, material, costeVeh, costeTec, descargos,
      rentabilidad, importe: origenCostes === 'sin coste' ? 0 : tramo(rentabilidad), tramo: null, origenCostes };
  });
  const primas = tecs[3] ? [{ idTec: tecs[3].id, nombre: tecs[3].nombre, formador: tecs[0]?.nombre || '', importe: 500 }] : [];
  return { ok: true, mes, version: '2.1', estado: mes < hoyIso().slice(0, 7) ? 'cerrado' : 'abierto', laborables: 22, filas,
    equipos: [
      { unidad: 'Búfala 1', obras: 41, fallidas: 3, fallidasNoImputables: 2, sat: 2, programadas: 46, ingresos: 18700, material: 4400, descargos: 690, diasOperados: 20, costeVeh: 480, combustible: 310 },
      { unidad: 'Búfala 2', obras: 30, fallidas: 4, fallidasNoImputables: 1, sat: 1, programadas: 36, ingresos: 9900, material: 2500, descargos: 450, diasOperados: 19, costeVeh: 460, combustible: 280 },
      { unidad: 'Búfala 3', obras: 12, fallidas: 2, fallidasNoImputables: 0, sat: 0, programadas: 15, ingresos: 3900, material: 1000, descargos: 120, diasOperados: 10, costeVeh: 500, combustible: 150 },
    ],
    primas, total: Math.round((filas.reduce((s, f) => s + f.importe, 0) + 250 * primas.length) * 100) / 100,
    costeNoTrabajado: { personal: 1180.5, vehiculo: 210 },
    incidencias: [{ fecha: `${mes}-07`, tecnico: tecs[1]?.nombre || 'Técnico', unidad: 'Búfala 2', tipo: 'Día trabajado sin fichaje' },
      { fecha: `${mes}-14`, tecnico: tecs[2]?.nombre || 'Técnico', unidad: 'Búfala 2', tipo: 'Día trabajado sin fichaje' }],
    excepciones: [{ tipo: 'Coste estimado', detalle: `${tecs[2]?.nombre || 'Técnico'}: sin nómina del mes` }, { tipo: 'Sin coste', detalle: `${tecs[3]?.nombre || 'Técnico'}: sin nómina ni referencia` },
      { tipo: 'Pendiente de Holded', detalle: 'E0000001 · 600,00 €' }, { tipo: 'Pendiente de Holded', detalle: 'E0000002 · 450,00 €' },
      { tipo: 'Alerta fallidas > 10 %', detalle: 'Búfala 2: 13 %' }],
    programadasFuente: { 'registro 07:30': 15, 'calendario (fecha de creación)': 6 },
    tramos: [] };
}

// Los 11 colores de evento de Google Calendar (colorId 1-11)
const COLORES_DEMO = [[1, 'Lavanda', '#7986cb'], [2, 'Salvia', '#33b679'], [3, 'Uva', '#8e24aa'], [4, 'Flamenco', '#e67c73'], [5, 'Plátano', '#f6bf26'],
  [6, 'Mandarina', '#f4511e'], [7, 'Pavo real', '#039be5'], [8, 'Grafito', '#616161'], [9, 'Arándano', '#3f51b5'], [10, 'Albahaca', '#0b8043'], [11, 'Tomate', '#d50000']];
const RESERVADOS_DEMO = { 8: 'Reservado para eventos de oficina', 11: 'Reservado para incidencias' };
function demoEquipos() {
  const activas = demo.unidades.filter(u => u.activa !== false && u.equipo);
  const n = Math.max(0, ...demo.unidades.map(u => Number((/^Búfala (\d+)$/.exec(u.id) || [])[1]) || 0)) + 1;
  return {
    coloresEvento: COLORES_DEMO.map(([id, nombre, hex]) => ({ id, nombre, hex, reservado: RESERVADOS_DEMO[id] || null, usadoPor: activas.find(u => Number(u.equipo.color) === id)?.id || null })),
    siguienteUnidad: `Búfala ${n}`,
    filasLibres: Math.max(0, 8 - demo.unidades.filter(u => u.equipo).length),
    saltoki: ['ALCOBENDAS', 'LEGANES'],
    avisos: [],
  };
}
// Mismo cuerpo que el guardado: { plan, error } sin tocar nada
function demoRevisarEquipos(p) {
  const plan = [];
  const eq = demoEquipos();
  for (const u of p.unidades || []) {
    const existente = u.id ? demo.unidades.find(x => x.id === u.id) : null;
    const nombre = existente?.nombre || u.nombre;
    if (!u.id && u.color === undefined && u.calendario === undefined) continue;   // alta antigua, sin datos de equipo
    if (!u.id && eq.filasLibres === 0) return { plan, error: 'No quedan filas libres en el bloque 👥 EQUIPOS.' };
    if (u.color !== undefined) {
      const c = eq.coloresEvento.find(x => x.id === Number(u.color));
      if (!c) return { plan, error: `El color ${u.color} no existe.` };
      if (c.reservado) return { plan, error: `El color ${c.nombre} está reservado: ${c.reservado}.` };
      if (c.usadoPor && c.usadoPor !== u.id) return { plan, error: `El color ${c.nombre} ya lo usa ${c.usadoPor}.` };
      plan.push(`${nombre}: eventos en color ${c.nombre}.`);
    }
    if (u.calendario?.modo === 'existente') plan.push(`${nombre}: usar el calendario existente ${u.calendario.id} y dar acceso a sus técnicos.`);
    else if (u.calendario || !u.id) plan.push(`${nombre}: crear un calendario nuevo y dar acceso a sus técnicos.`);
    if (u.salidaKm !== undefined) plan.push(`${nombre}: los km salen de «${u.salidaKm || 'sin dirección'}».`);
    if (u.saltoki !== undefined) plan.push(`${nombre}: Saltoki habitual ${u.saltoki || '—'}.`);
    if (u.naveDesde !== undefined) plan.push(u.naveDesde ? `${nombre}: pasa por la nave desde el ${u.naveDesde}.` : `${nombre}: no pasa por la nave.`);
    if (!u.id) plan.push(`Se escribe ${nombre} en la fila libre del bloque 👥 EQUIPOS.`);
  }
  for (const a of p.asignaciones || []) {
    if (a.idTec) plan.push(`${demo.tecnicos.find(t => t.id === a.idTec)?.nombre || a.idTec} → ${a.idUnidad} desde el ${a.desde}.`);
    else if (a.matricula) plan.push(`Furgoneta ${a.matricula} → ${a.idUnidad} desde el ${a.desde} (se avisa al almacén).`);
  }
  for (const t of p.tecnicos || []) if (t.correo !== undefined) plan.push(`${t.nombre || t.id}: correo ${t.correo || 'borrado'}.`);
  return { plan };
}
// Guarda los datos de equipo y devuelve lo que contesta el backend real
function demoAplicarEquipos(p) {
  const calendarios = [], accesos = [], avisos = [];
  for (const u of p.unidades || []) {
    if (u.color === undefined && u.calendario === undefined && u.salidaKm === undefined && u.saltoki === undefined && u.naveDesde === undefined) continue;
    const id = u.id || u.nombre;
    const previo = demo.unidades.find(x => x.id === id)?.equipo || { fila: 3 + demo.unidades.filter(x => x.equipo).length + 1, color: null, calendarioId: '', salidaKm: '', saltoki: '', naveDesde: null };
    const equipo = { ...previo };
    if (u.color !== undefined) equipo.color = Number(u.color);
    if (u.salidaKm !== undefined) equipo.salidaKm = u.salidaKm;
    if (u.saltoki !== undefined) equipo.saltoki = u.saltoki;
    if (u.naveDesde !== undefined) equipo.naveDesde = u.naveDesde || null;
    if (u.calendario) {
      const creado = u.calendario.modo !== 'existente';
      equipo.calendarioId = creado ? `demo-${id.toLowerCase().replace(/\W+/g, '')}-${Date.now() % 1000}@group.calendar.google.com` : u.calendario.id;
      calendarios.push({ unidad: id, calendarioId: equipo.calendarioId, creado });
      for (const a of (p.asignaciones || []).filter(a => a.idTec && a.idUnidad === id)) {
        const t = demo.tecnicos.find(x => x.id === a.idTec);
        accesos.push(t?.correo ? `${t.nombre}: puede editar el calendario de ${id} (${t.correo}).` : `${t?.nombre || a.idTec}: sin correo, no se le ha dado acceso al calendario.`);
      }
    }
    // Las altas las da de alta el código de siempre; aquí solo se guarda el equipo
    u.equipo = equipo;
    for (const k of ['color', 'calendario', 'salidaKm', 'saltoki', 'naveDesde']) delete u[k];
    if ((p.asignaciones || []).some(a => !a.idTec && a.matricula && a.idUnidad === id)) avisos.push(`Aviso enviado al almacén: furgoneta nueva en ${id}.`);
  }
  for (const t of p.tecnicos || []) if (t.correo === '') t.correo = null;
  return { calendarios, accesos, avisos };
}

function demoResponder(accion, params, p) {
  const conActivo = (lista, d, h) => lista.map(o => ({ ...o, activo: vig(o[d], o[h], hoyIso()) }));
  switch (accion) {
    case 'panelConfig':
      return { ok: true, tecnicos: conActivo(demo.tecnicos, 'alta', 'baja'), vehiculos: conActivo(demo.vehiculos, 'desde', 'hasta'),
        unidades: demo.unidades, asignaciones: demo.asignaciones, tramos: demo.tramos, ejercicio: demo.ejercicio, limites: demo.limites,
        equipos: demoEquipos() };
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
      // Alta completa de equipos: se valida todo antes de escribir; con simular: true solo se cuenta el plan
      const revision = demoRevisarEquipos(p);
      if (p.simular) return { ok: true, simulacion: true, plan: revision.plan, ...(revision.error ? { error: revision.error } : {}) };
      if (revision.error) return { ok: false, accion, error: revision.error };
      const resultado = demoAplicarEquipos(p);
      const nuevas = p.asignaciones || [];
      const ids = nuevas.filter(a => a.idTec && a.idUnidad).map(a => a.idTec);
      if (new Set(ids).size !== ids.length) return { ok: false, error: 'Un técnico aparece en dos unidades el mismo día.' };
      // Como el backend: una edición o baja trae solo los campos que cambian y se mezclan con lo que había
      const poner = (lista, clave, o) => { const i = lista.findIndex(x => x[clave] === o[clave]); if (i >= 0) lista[i] = { ...lista[i], ...o }; else lista.push(o); };
      // Las altas llegan sin id: lo asigna el backend y lo devuelve
      const asignados = { tecnicos: [], unidades: [] };
      const siguiente = (lista, pref, cifras) => pref + String(Math.max(0, ...lista.map(x => Number(String(x.id).replace(/\D/g, '')) || 0)) + 1).padStart(cifras, '0');
      for (const t of p.tecnicos || []) { if (!t.id) { t.id = siguiente(demo.tecnicos, 'T', 2); t.rol = t.rol || 'Instalador'; asignados.tecnicos.push({ nombre: t.nombre, id: t.id }); } poner(demo.tecnicos, 'id', t); }
      (p.vehiculos || []).forEach(v => poner(demo.vehiculos, 'matricula', v));
      // Como el backend, el id de una unidad nueva es su nombre (sin repetir)
      for (const u of p.unidades || []) {
        if (!u.id) {
          // Como el backend: el id es el nombre, no se repite, y computaVariable se deriva del nombre
          if (demo.unidades.some(x => x.id === u.nombre)) return { ok: false, rechazado: true, accion, error: `Ya existe la unidad «${u.nombre}».` };
          u.id = u.nombre; asignados.unidades.push({ nombre: u.nombre, id: u.id });
          poner(demo.unidades, 'id', { tipo: 'productiva', activa: true, computaVariable: /^Búfala \d+$/.test(u.nombre), ...u });
          continue;
        }
        poner(demo.unidades, 'id', u);
      }
      if (nuevas.some(a => a.hasta && !a.idTec)) return { ok: false, error: 'El periodo «hasta» solo vale para técnicos, no para furgonetas.' };
      if (nuevas.some(a => a.hasta && a.hasta < a.desde)) return { ok: false, error: 'La fecha «hasta» no puede ser anterior a «desde».' };
      const diaDespues = iso => { const [y, m, d] = iso.split('-').map(Number); return aIso(new Date(y, m - 1, d + 1)); };
      for (const a of nuevas) {
        const tramosPosteriores = [];
        for (const v of [...demo.asignaciones]) {
          const mismo = a.idTec ? v.idTec === a.idTec : (!v.idTec && v.idUnidad === a.idUnidad);
          if (!mismo || !vig(v.desde, v.hasta, a.desde)) continue;
          // Puntual: lo que tenía vuelve al día siguiente del «hasta»
          if (a.hasta && (!v.hasta || v.hasta > a.hasta)) tramosPosteriores.push({ ...v, desde: diaDespues(a.hasta), derivada: undefined });
          if (v.desde && v.desde >= a.desde) demo.asignaciones.splice(demo.asignaciones.indexOf(v), 1);
          else v.hasta = diaAntes(a.desde);
        }
        if (a.idUnidad) demo.asignaciones.push({ ...a, hasta: a.hasta || null });
        demo.asignaciones.push(...tramosPosteriores);
      }
      return { ok: true, accion, avisos: resultado.avisos, ids: asignados, calendarios: resultado.calendarios, accesos: resultado.accesos };
    }
    case 'panelAsignarCombustible':
      for (const a of p.asignaciones || []) for (const lista of Object.values(demo.facturas)) {
        const f = lista.find(x => x.id === a.idFactura);
        if (f) f.matricula = a.matricula || null;
      }
      return { ok: true, accion };
    case 'panelClasificarProveedor':
      if (p.todas) {
        if (['mixto', 'materialUso'].includes(p.tipo)) return { ok: false, error: 'Con «todas» no se puede usar «mixto» ni «material de uso».' };
        const base = String(p.proveedor).split(' · ')[0];
        const suyo = f => String(f.proveedor).split(' · ')[0] === base;
        let filas = 0;
        for (const [mes, lista] of Object.entries(demo.sinClasificar)) {
          const suyas = lista.filter(suyo);
          demo.sinClasificar[mes] = lista.filter(f => !suyo(f));
          (demo.facturas[mes] ||= []).push(...suyas.map(f => ({ ...f, tipo: p.tipo, matricula: null, manual: false })));
          filas += suyas.length;
        }
        for (const lista of Object.values(demo.facturas)) for (const f of lista) if (suyo(f) && f.tipo !== p.tipo) { f.tipo = p.tipo; filas++; }
        return { ok: true, accion, filas, avisos: [`${base}: ${filas} factura${filas === 1 ? '' : 's'} ${filas === 1 ? 'pasa' : 'pasan'} a «${p.tipo}». Las próximas entrarán así.`] };
      }
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
