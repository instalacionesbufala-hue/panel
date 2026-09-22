// Entrada del panel: navegación, pantalla de acceso y aviso de conexión.
import * as api from './api.js';
import * as unidades from './unidades.js';
import * as combustible from './combustible.js';
import * as costes from './costes.js';
import * as maestros from './tecnicos.js';
import * as liquidacion from './liquidacion.js';

const VISTAS = { unidades, combustible, costes, maestros, liquidacion };
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
  $('#acceso-motivo').textContent = motivo || 'Introduce la contraseña del panel.';
  $('#acceso-error').hidden = true;
  $('#clave').value = '';
  capa.hidden = false;
  $('#salir').hidden = true;
  setTimeout(() => $('#clave').focus(), 0);
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
    await api.entrar(clave);
    $('#clave').value = '';
    $('#acceso').hidden = true;
    $('#salir').hidden = false;
    const resolver = $('#acceso')._resolver;
    esperaAcceso = null;
    resolver && resolver();
  } catch (e) {
    const err = $('#acceso-error');
    err.textContent = e.tipo === 'backend' ? (e.message || 'Contraseña incorrecta.') : e.message;
    err.hidden = false;
    $('#clave').select();
  } finally {
    boton.disabled = false;
    boton.textContent = 'Entrar';
  }
});

api.alPedirAcceso(pedirAcceso);

$('#salir').addEventListener('click', () => {
  if (vistaActual?.control?.pendiente?.() && !confirm('Hay cambios sin guardar. ¿Cerrar la sesión igualmente?')) return;
  api.cerrarSesion();
  location.hash = '#' + VISTA_INICIAL;
  location.reload();
});

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

// Arranque: sin sesión, primero la contraseña.
(async function arrancar() {
  if (!api.haySesion()) await pedirAcceso();
  else $('#salir').hidden = false;
  mostrar(nombreDesdeHash());
})();
