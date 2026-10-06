// Entrada del panel: navegación, pantalla de acceso y aviso de conexión.
import * as api from './api.js?v=30';
import { mesActual, avisar } from './ui.js?v=30';
import { activarAyudas } from './ayudas.js?v=30';
import * as unidades from './unidades.js?v=30';
import * as combustible from './combustible.js?v=30';
import * as costes from './costes.js?v=30';
import * as maestros from './tecnicos.js?v=30';
import * as liquidacion from './liquidacion.js?v=30';
import * as ausencias from './ausencias.js?v=30';
import * as configuracion from './configuracion.js?v=30';

const VISTAS = { unidades, combustible, costes, ausencias, maestros, liquidacion, configuracion };
const VISTA_INICIAL = 'unidades';

const $ = s => document.querySelector(s);
let vistaActual = null;     // { nombre, control }
let nombreActual = null;

// ── Acceso ─────────────────────────────────────────────
// Una sola espera compartida: si varias llamadas caducan a la vez, se pide la clave una vez.
let esperaAcceso = null;
function pedirAcceso(motivo) {
  if (esperaAcceso) return esperaAcceso;
  const capa = $('#acceso');
  $('#acceso-motivo').textContent = motivo || 'Introduce tu correo y tu contraseña.';
  $('#acceso-error').hidden = true;
  $('#clave').value = '';
  capa.hidden = false;
  $('#salir').hidden = true;
  setTimeout(() => ($('#correo').value ? $('#clave') : $('#correo')).focus(), 0);
  esperaAcceso = new Promise(resolver => { capa._resolver = resolver; });
  return esperaAcceso;
}

$('#form-acceso').addEventListener('submit', async ev => {
  ev.preventDefault();
  const boton = ev.target.querySelector('button');
  const clave = $('#clave').value;
  boton.disabled = true;
  boton.textContent = 'Comprobando…';
  try {
    await api.entrar($('#correo').value, clave);
    pintarFranjaDemo();
    $('#clave').value = '';
    $('#acceso').hidden = true;
    $('#salir').hidden = false;
    const resolver = $('#acceso')._resolver;
    esperaAcceso = null;
    resolver && resolver();
  } catch (e) {
    const err = $('#acceso-error');
    err.textContent = e.tipo === 'backend' ? (e.message || 'Correo o contraseña incorrectos.') : e.message;
    err.hidden = false;
    $('#clave').select();
  } finally {
    boton.disabled = false;
    boton.textContent = 'Entrar';
  }
});

api.alPedirAcceso(pedirAcceso);
activarAyudas();

// ── Contador de facturas pendientes en la pestaña «Combustible» ──
// Se actualiza con cada lectura de panelCompras (al entrar y tras cada asignación o clasificación).
function pintarContador(p) {
  const a = $('#menu a[data-vista="combustible"]');
  let c = a.querySelector('.contador');
  const total = p ? (p.sinAsignar || 0) + (p.sinClasificar || 0) : 0;
  if (!total) { c?.remove(); a.removeAttribute('title'); return; }
  if (!c) { c = document.createElement('span'); c.className = 'contador'; a.append(c); }
  c.textContent = total > 99 ? '99+' : total;
  const partes = [];
  if (p.sinAsignar) partes.push(`${p.sinAsignar} factura${p.sinAsignar === 1 ? '' : 's'} sin matrícula ni Estructura`);
  if (p.sinClasificar) partes.push(`${p.sinClasificar} sin clasificar`);
  a.title = 'Pendiente: ' + partes.join(' · ');
  c.setAttribute('aria-label', a.title);
}
api.alCambiarPendientes(pintarContador);

// Reintento automático de una petición a la que Google no ha contestado bien
api.alReintentar(() => avisar('Reintentando… El servidor no ha contestado bien a la primera.', 'aviso', 6000));
// Tras un guardado, el backend recalcula los costes en segundo plano. Un solo aviso aunque se guarde varias veces seguidas.
let ultimoAvisoCostes = 0;
api.alCostesEnCola(() => {
  if (Date.now() - ultimoAvisoCostes < 20000) return;
  ultimoAvisoCostes = Date.now();
  avisar('Guardado. Los costes se actualizan en 1-2 minutos.', 'info', 7000);
});
// Primera lectura al arrancar, detrás de la de la pantalla (las peticiones salen de una en una)
const leerPendientes = () => api.leerCompras(mesActual()).catch(() => { /* ya lo avisa la franja de conexión */ });

// Aviso permanente mientras alguna acción se sirva con datos de ejemplo (la lista la da el ping del backend)
function pintarFranjaDemo() {
  api.accionesEnProduccion().then(reales => {
    const d = $('#franja-demo');
    const demo = api.TODAS.filter(a => !reales.has(a));
    d.hidden = demo.length === 0;
    if (!demo.length) return;
    const datosReales = [...reales].filter(a => a !== 'panelLogin');
    d.innerHTML = '<strong>Modo demostración.</strong> '
      + (datosReales.length
        ? `Van al sistema de gestión: ${datosReales.join(', ')}. El resto usa datos de ejemplo, que se pierden al recargar.`
        : 'El acceso es real, pero los datos son de ejemplo: lo que guardes se queda en esta pestaña y se pierde al recargar. No se envía nada al sistema de gestión.');
  }).catch(() => { /* sin conexión: ya lo avisa la franja de conexión; se reintenta al entrar */ });
}
// Sin sesión no se pregunta: tras entrar, la lista sale de `vistas` y no hace falta esperar a Apps Script
api.haySesion().then(s => { if (s) pintarFranjaDemo(); });

$('#salir').addEventListener('click', async () => {
  if (vistaActual?.control?.pendiente?.() && !confirm('Hay cambios sin guardar. ¿Cerrar la sesión igualmente?')) return;
  await api.cerrarSesion();
  location.hash = '#' + VISTA_INICIAL;
  location.reload();
});

// ── De cuándo son los datos ───────────────────────────
// Las pantallas leen la copia que el backend publica en Supabase (tras cada guardado y cada hora de 7 a 22 h).
// Se enseña la más antigua entre la última lectura de cada dato de la pantalla actual; lo leído por el puente es «al momento».
const leidos = new Map();   // acción → hora de la copia (null: al momento)
function pintarFrescura() {
  const p = $('#frescura');
  if (!leidos.size) { p.hidden = true; return; }
  const horas = [...leidos.values()].filter(h => h !== null);
  const datosDe = horas.length ? Math.min(...horas) : null;
  const min = datosDe === null ? 0 : Math.floor((Date.now() - datosDe) / 60000);
  p.textContent = datosDe === null || min < 1 ? 'Datos al momento'
    : min < 60 ? `Datos de hace ${min} min`
    : `Datos de hace ${Math.floor(min / 60)} h${min % 60 ? ' ' + (min % 60) + ' min' : ''}`;
  p.title = 'El servidor publica una copia de cada pantalla tras cada guardado y cada hora de 7 a 22 h. Tras guardar, la pantalla se lee directamente durante 5 minutos.';
  p.hidden = false;
}
api.alLeerDatos(({ accion, actualizado }) => {
  // Las compras del mes se leen por detrás para el contador del menú: solo cuentan en Combustible
  if (accion === 'panelCompras' && nombreActual !== 'combustible') return;
  leidos.set(accion, actualizado ? Date.parse(actualizado) : null);
  pintarFrescura();
});
setInterval(pintarFrescura, 30000);

// ── Aviso de conexión ─────────────────────────────────
api.alCambiarConexion((ok, detalle) => {
  const f = $('#franja');
  if (ok) { f.hidden = true; return; }
  f.innerHTML = `<span><strong>Sin conexión con el servidor.</strong> ${detalle || ''} Lo que hayas escrito sigue en pantalla.</span>
    <button type="button" class="boton secundario mini" id="reintentar">Reintentar</button>`;
  f.hidden = false;
  f.querySelector('#reintentar').onclick = () => vistaActual?.control?.recargar?.();
});

// ── Navegación ────────────────────────────────────────
function nombreDesdeHash() {
  const n = location.hash.replace('#', '');
  return VISTAS[n] ? n : VISTA_INICIAL;
}

async function mostrar(nombre) {
  if (vistaActual?.control?.desmontar) vistaActual.control.desmontar();
  nombreActual = nombre;
  document.querySelectorAll('#menu a').forEach(a => {
    if (a.dataset.vista === nombre) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  leidos.clear();
  pintarFrescura();
  const el = $('#vista');
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const control = VISTAS[nombre].montar(el) || {};
  vistaActual = { nombre, control };
}

window.addEventListener('hashchange', () => {
  const nuevo = nombreDesdeHash();
  if (nuevo === nombreActual) return;
  if (vistaActual?.control?.pendiente?.() && !confirm('Hay cambios sin guardar en esta pantalla. ¿Salir sin guardarlos?')) {
    history.replaceState(null, '', '#' + nombreActual);
    return;
  }
  mostrar(nuevo);
});

window.addEventListener('beforeunload', ev => {
  if (vistaActual?.control?.pendiente?.()) { ev.preventDefault(); ev.returnValue = ''; }
});

// Arranque: sin sesión, primero el acceso.
(async function arrancar() {
  if (!(await api.haySesion())) await pedirAcceso();
  else $('#salir').hidden = false;
  mostrar(nombreDesdeHash());
  if (nombreActual !== 'combustible') leerPendientes();   // Combustible ya lo lee por su cuenta
})();
