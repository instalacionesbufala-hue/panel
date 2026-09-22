// Única capa que habla con el backend. Ningún otro módulo hace fetch.

// URL de la implementación activa de Apps Script. Es el único sitio donde se configura.
export const URL_BACKEND = 'https://script.google.com/macros/s/AKfycbxMMeyP9g75p1lxytithxeFfQVbe0cXV3aFHlJObfI05ewIN1mtTxPYBNPYp--BPKc9tw/exec';

const CLAVE_TESTIGO = 'bufala-panel-testigo';
const ESPERA_MAX_MS = 60000;

export class ErrorApi extends Error {
  // tipo: 'red' (no hay conexión), 'contrato' (el backend no conoce la acción),
  //       'backend' (el backend rechaza), 'sesion' (hay que volver a entrar)
  constructor(mensaje, tipo) {
    super(mensaje);
    this.tipo = tipo;
  }
}

// ── Sesión ──────────────────────────────────────────────
function leerTestigo() {
  try {
    const t = JSON.parse(sessionStorage.getItem(CLAVE_TESTIGO) || 'null');
    if (!t || !t.token) return null;
    if (t.caduca && Date.parse(t.caduca) <= Date.now()) {
      sessionStorage.removeItem(CLAVE_TESTIGO);
      return null;
    }
    return t;
  } catch {
    return null;
  }
}
function guardarTestigo(token, caduca) {
  try { sessionStorage.setItem(CLAVE_TESTIGO, JSON.stringify({ token, caduca: caduca || null })); } catch { /* sin almacenamiento: la sesión dura lo que la pestaña */ }
  testigoEnMemoria = { token, caduca };
}
let testigoEnMemoria = null;
function testigoActual() {
  const t = leerTestigo() || testigoEnMemoria;
  if (t && t.caduca && Date.parse(t.caduca) <= Date.now()) return null;
  return t ? t.token : null;
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

// ── Transporte ─────────────────────────────────────────
function esSesionCaducada(r) {
  const c = String(r.codigo || r.code || '').toLowerCase();
  return c === 'sesion' || c === 'sesion_caducada' || r.sesionCaducada === true;
}

// SALVAGUARDA: el doPost actual del backend trata CUALQUIER POST como un cierre de obra y lo
// encola. Antes de enviar nada por POST se comprueba con ?action=ping (solo lectura) que el
// backend declara el panel ("panel": true). Si no, no se envía nada.
let backendConPanel = null;
async function comprobarBackend() {
  if (backendConPanel) return;
  const r = await peticion('ping', {}, true);
  if (!r.panel) {
    throw new ErrorApi('El backend activo (' + (r.version || 'versión desconocida') + ') todavía no tiene las acciones del panel. '
      + 'No se ha enviado nada: con el backend actual, cualquier envío se registraría como un cierre de obra.', 'contrato');
  }
  backendConPanel = true;
}

async function peticion(accion, { metodo = 'GET', params = {}, cuerpo = null, conTestigo = true } = {}, sinComprobar = false) {
  if (metodo !== 'GET' && !sinComprobar) await comprobarBackend();
  const url = new URL(URL_BACKEND);
  url.searchParams.set('action', accion);
  const token = conTestigo ? testigoActual() : null;
  const opciones = { method: metodo, redirect: 'follow' };

  if (metodo === 'GET') {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (token) url.searchParams.set('token', token);
  } else {
    // application/x-www-form-urlencoded: petición simple, sin comprobación previa CORS
    const form = new URLSearchParams();
    form.set('payload', JSON.stringify(cuerpo ?? {}));
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
    // Apps Script devuelve una página HTML cuando no reconoce la acción
    avisarConexion(true);
    throw new ErrorApi(`El servidor no reconoce la acción «${accion}». Hay que añadirla al backend (ver DECISIONES.md).`, 'contrato');
  }
  avisarConexion(true);

  if (datos && datos.ok === false) {
    if (esSesionCaducada(datos)) throw new ErrorApi(datos.error || 'La sesión ha caducado.', 'sesion');
    throw new ErrorApi(datos.error || 'El servidor ha rechazado la operación sin indicar el motivo.', 'backend');
  }
  if (!datos || datos.ok !== true) {
    throw new ErrorApi(`Respuesta inesperada del servidor en «${accion}».`, 'contrato');
  }
  // En las escrituras el backend debe repetir la acción: así se sabe que no la ha tratado como otra cosa
  if (metodo !== 'GET' && datos.accion !== accion) {
    throw new ErrorApi(`El servidor ha respondido a «${accion}» sin confirmarla. No se da por guardado.`, 'contrato');
  }
  return datos;
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
  const r = await peticion('panelLogin', { metodo: 'POST', cuerpo: { clave }, conTestigo: false });
  if (!r.token) throw new ErrorApi('El servidor no ha devuelto el testigo de sesión.', 'contrato');
  guardarTestigo(r.token, r.caduca);
  return r;
}

export const leerConfig = () => llamar('panelConfig');
export const leerCompras = mes => llamar('panelCompras', { params: { mes } });
export const leerLiquidacion = mes => llamar('panelLiquidacion', { params: { mes } });

export const guardarConfig = cambios => llamar('panelGuardarConfig', { metodo: 'POST', cuerpo: cambios });
export const asignarCombustible = asignaciones => llamar('panelAsignarCombustible', { metodo: 'POST', cuerpo: { asignaciones } });
export const clasificarProveedor = (proveedor, tipo) => llamar('panelClasificarProveedor', { metodo: 'POST', cuerpo: { proveedor, tipo } });
export const guardarCostes = (mes, costes, origen) => llamar('panelCostesTecnico', { metodo: 'POST', cuerpo: { mes, costes, origen } });
