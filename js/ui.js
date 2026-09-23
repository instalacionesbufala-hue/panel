// Utilidades de interfaz compartidas por todas las pantallas.

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtEur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
export const eur = n => (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) ? '—' : fmtEur.format(Number(n));

const fmtFecha = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
export function fecha(iso) {
  if (!iso) return '—';
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!a || !m || !d) return esc(iso);
  return fmtFecha.format(new Date(a, m - 1, d));
}
const fmtMes = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' });
export function nombreMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  return fmtMes.format(new Date(a, m - 1, 1));
}

// Fechas locales en formato AAAA-MM-DD (no toISOString, que va en UTC)
const dos = n => String(n).padStart(2, '0');
export const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`; };
export const mesActual = () => hoy().slice(0, 7);
export function sumarMeses(mes, n) {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}`;
}
export function diaAnterior(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  const x = new Date(a, m - 1, d - 1);
  return `${x.getFullYear()}-${dos(x.getMonth() + 1)}-${dos(x.getDate())}`;
}
// ¿Está vigente un periodo [desde, hasta] (ambos inclusive, hasta puede ser null) en la fecha dada?
export const vigente = (desde, hasta, dia) => (!desde || desde <= dia) && (!hasta || hasta >= dia);
// ¿Solapa el periodo con algún día del mes?
export const vigenteEnMes = (desde, hasta, mes) => (!desde || desde.slice(0, 7) <= mes) && (!hasta || hasta.slice(0, 7) >= mes);

// Importes tecleados a la española: «2.579,29» o «2579.29»
export function leerImporte(texto) {
  let t = String(texto ?? '').trim().replace(/\s|€/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
export const importeEditable = n => (n === null || n === undefined) ? '' : Number(n).toFixed(2).replace('.', ',');

// Avisos flotantes
export function avisar(mensaje, tipo = 'info', ms = 6000) {
  const caja = document.getElementById('avisos');
  const el = document.createElement('div');
  el.className = `aviso-flotante ${tipo}`;
  el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  el.textContent = mensaje;
  caja.appendChild(el);
  setTimeout(() => el.remove(), tipo === 'error' ? Math.max(ms, 10000) : ms);
}

// Diálogo de confirmación. cuerpoHtml puede incluir campos; devuelve el <form> o null si se cancela.
export function preguntar(titulo, cuerpoHtml, { aceptar = 'Aceptar', cancelar = 'Cancelar', peligro = false } = {}) {
  const dlg = document.getElementById('dialogo');
  if (dlg.open) { dlg.returnValue = ''; dlg.close(); }   // un diálogo anterior sin responder cuenta como cancelado
  dlg.querySelector('#dialogo-titulo').textContent = titulo;
  dlg.querySelector('#dialogo-cuerpo').innerHTML = cuerpoHtml;
  const si = dlg.querySelector('#dialogo-si');
  si.textContent = aceptar;
  si.className = peligro ? 'boton peligro' : 'boton';
  dlg.querySelector('#dialogo-no').textContent = cancelar;
  dlg.returnValue = '';
  return new Promise(resolver => {
    // Se responde en cuanto se envía el formulario; 'close' queda para Escape y para el cierre forzado.
    // (El evento 'close' puede retrasarse si la página no se está dibujando.)
    const form = dlg.querySelector('form');
    let respondido = false;
    const responder = acepta => {
      if (respondido) return;
      respondido = true;
      form.removeEventListener('submit', alEnviar);
      resolver(acepta ? form : null);
    };
    const alEnviar = ev => responder(ev.submitter?.value === 'si');
    form.addEventListener('submit', alEnviar);
    dlg.addEventListener('close', () => responder(dlg.returnValue === 'si'), { once: true });
    dlg.showModal();
    const primero = dlg.querySelector('#dialogo-cuerpo input, #dialogo-cuerpo select');
    if (primero) primero.focus();
  });
}

// Muestra un error de la API en una caja dentro de la vista
export const cajaError = (e, titulo = 'No se ha podido completar') =>
  `<div class="caja-error" role="alert"><strong>${esc(e.tipo === 'red' ? 'Sin conexión' : e.tipo === 'solo-lectura' ? 'Aún no se puede guardar' : titulo)}.</strong> ${esc(e.message || e)}</div>`;

export function listaAvisos(avisos) {
  if (!avisos || !avisos.length) return;
  avisos.forEach(a => avisar(typeof a === 'string' ? a : (a.mensaje || JSON.stringify(a)), 'aviso', 12000));
}

// Selector de mes reutilizable
export const selectorMes = (id, valor) => `<label>Mes<input type="month" id="${id}" value="${esc(valor)}" required></label>`;
