// «CIE» (BACKEND.md, «CIE pendientes — vista `panelCIE` y acción `panelCieMarcar`»; issue #28; spec 006).
// Obras de Instant Box y de cliente directo a las que les falta el CIE (boletín). Solo gerencia.
// La pantalla no calcula ni ordena: el orden, los días y el total llegan hechos del backend.
// Marcar: la fila cambia al instante; las marcas seguidas se agrupan y salen en UNA petición por la cola.
import * as api from './api.js?v=47';
import { esc, fecha, avisar, preguntar, cajaError } from './ui.js?v=47';

const ESPERA_AGRUPAR_MS = 1500;    // desde la última casilla hasta que sale la petición
const ESPERA_OCUPADO_MS = 5000;    // `ocupado: true`: un solo reintento pasado este tiempo
const MAX_POR_PETICION = 100;      // límite del contrato
const MAX_NOTA = 200;

const PARTNERS = { INSTANTBOX: 'Instant Box', DIRECTO: 'Directo' };
const ORIGENES = { MANUAL: 'Manual', 'AUTOMÁTICO': 'Automático', AUTOMATICO: 'Automático' };
const partner = p => PARTNERS[p] || p || '—';
const texto = v => (v === null || v === undefined || v === '') ? '—' : esc(v);
const pausa = ms => new Promise(r => setTimeout(r, ms));
// «2026-11-17 18:05» → «17/11/2026 18:05»; cualquier otro texto, tal cual
const fechaTexto = t => { const m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(String(t || '')); return m ? `${m[3]}/${m[2]}/${m[1]}${m[4]}` : t; };

function fechaHora(iso) {
  const f = iso ? new Date(iso) : null;
  if (!f || Number.isNaN(f.getTime())) return '';
  return f.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
// Con sinCargador, `cargador` trae «Sin cargador (motivo)»: se enseña la marca y, al lado, solo el motivo
function celdaCargador(o) {
  if (!o.sinCargador) return texto(o.cargador);
  const m = /^\s*sin cargador\s*\((.*)\)\s*$/i.exec(o.cargador || '');
  const resto = m ? m[1] : /^\s*sin cargador\s*$/i.test(o.cargador || '') ? '' : (o.cargador || '');
  return `<span class="insignia aviso">sin cargador</span>${resto ? ' <span class="tenue">' + esc(resto) + '</span>' : ''}`;
}

// v1.1 de la vista (Panel CIE.gs): enlace a la página de boletines con los datos de la obra (solo esa página)
const BOLETINES = 'https://instalacionesbufala-hue.github.io/boletines-irve/';
function celdaBoletin(o) {
  if (!o.enlaceBoletin || !String(o.enlaceBoletin).startsWith(BOLETINES)) return o.enlaceError ? `<span class="tenue" title="${esc(o.enlaceError)}">sin enlace</span>` : '—';
  const faltan = (o.faltan || []).length;
  return `<a class="boton secundario cie-boletin" href="${esc(o.enlaceBoletin)}" target="_blank" rel="noopener noreferrer">Abrir en boletines</a>`
    + (faltan ? `<span class="tenue cie-faltan" title="${esc(o.faltan.join('\n'))}">${faltan} ${faltan === 1 ? 'dato a revisar' : 'datos a revisar'}</span>` : '');
}

export function montar(el) {
  let vista = null, cargando = true, errorCarga = null, errorMarca = null;
  let vivo = true, temporizador = null, enCurso = false, reintentando = false, hechosAbierto = false;
  const marcadas = new Set();      // casillas marcadas que aún no han salido
  const enviando = new Set();      // obras de la petición en curso (marcar o deshacer)

  async function recargar() {
    cargando = true; errorCarga = null;
    pintar();
    try { vista = await api.leerCie(); } catch (e) { errorCarga = e; }
    cargando = false;
    // Lo marcado que ya no esté entre los pendientes (lo hizo otra sesión) deja de estar marcado
    const quedan = new Set((vista?.pendientes || []).map(o => o.num));
    [...marcadas].forEach(n => { if (!quedan.has(n)) marcadas.delete(n); });
    pintar();
  }

  function filaPendiente(o) {
    const saliendo = enviando.has(o.num), marcada = marcadas.has(o.num);
    const estado = saliendo ? (reintentando ? 'Servidor ocupado, reintentando…' : 'Guardando…') : marcada ? 'Hecho' : '';
    return `<tr class="${saliendo || marcada ? 'cie-marcada' : ''}">
      <td class="cie-casilla"><label><input type="checkbox" data-num="${esc(o.num)}" ${saliendo || marcada ? 'checked' : ''} ${saliendo ? 'disabled' : ''}
        aria-label="Dar por hecho el CIE de ${esc(o.num)}"><span>${estado}</span></label></td>
      <td class="cie-num">${texto(o.num)}</td>
      <td>${esc(partner(o.partner))}</td>
      <td>${texto(o.cliente)}</td>
      <td class="cie-direccion">${texto(o.direccion)}</td>
      <td>${fecha(o.fechaCierre)}</td>
      <td>${texto(o.equipo)}</td>
      <td>${celdaCargador(o)}</td>
      <td class="cie-dias">${texto(o.diasPendiente)}</td>
      <td class="cie-nota">${o.nota ? esc(o.nota) : ''}</td>
      <td class="cie-enlace">${celdaBoletin(o)}</td>
    </tr>`;
  }
  function filaHecho(o) {
    const saliendo = enviando.has(o.num);
    return `<tr>
      <td class="cie-num">${texto(o.num)}</td>
      <td>${esc(partner(o.partner))}</td>
      <td>${texto(o.cliente)}</td>
      <td class="cie-direccion">${texto(o.direccion)}</td>
      <td>${fecha(o.fechaCierre)}</td>
      <td>${texto(o.equipo)}</td>
      <td>${celdaCargador(o)}</td>
      <td>${texto(fechaTexto(o.hechoFecha))}</td>
      <td>${esc(ORIGENES[String(o.hechoOrigen || '').toUpperCase()] || o.hechoOrigen || '—')}</td>
      <td>${texto(o.hechoQuien)}</td>
      <td class="cie-nota">${o.nota ? esc(o.nota) : ''}</td>
      <td><button type="button" class="boton secundario" data-deshacer="${esc(o.num)}" ${saliendo ? 'disabled' : ''}>${saliendo ? 'Deshaciendo…' : 'Deshacer'}</button></td>
    </tr>`;
  }

  function pintar() {
    if (!vivo) return;
    const cabecera = `<div class="barra">
        <div><h1>CIE</h1><p class="tenue">Obras de Instant Box y de cliente directo a las que les falta el CIE (boletín).</p></div>
        <span class="empuje"></span>
        <button type="button" class="boton secundario" data-accion="recargar" ${cargando ? 'disabled' : ''}>Actualizar</button>
      </div>`;
    if (cargando && !vista) { el.innerHTML = cabecera + '<p class="cargando">Cargando…</p>'; return; }
    if (errorCarga) { el.innerHTML = cabecera + cajaError(errorCarga, 'No se ha podido leer la lista de CIE'); return; }
    if (!vista) {
      el.innerHTML = cabecera + '<div class="tarjeta bloque"><p class="tenue" style="margin:0">La lista de CIE aún no está publicada. Se publica cada hora, de 7 a 22.</p></div>';
      return;
    }
    const pendientes = vista.pendientes || [], hechos = vista.hechos || [];
    const sinEnviar = marcadas.size + [...enviando].filter(n => pendientes.some(o => o.num === n)).length;
    el.innerHTML = `${cabecera}
      <div class="barra cie-resumen" style="align-items:center">
        <span class="cie-total"><strong>${texto(vista.totalPendientes)}</strong> ${Number(vista.totalPendientes) === 1 ? 'pendiente' : 'pendientes'}</span>
        ${sinEnviar ? `<span class="insignia ok" aria-live="polite">${sinEnviar} ${sinEnviar === 1 ? 'marcado, guardando' : 'marcados, guardando'}…</span>` : ''}
        <span class="empuje"></span>
        <span class="tenue">Datos de: ${esc(fechaHora(vista.generado) || '—')}</span>
      </div>
      ${errorMarca ? cajaError(errorMarca, 'No se ha podido guardar') : ''}
      ${errorMarca?.sinConfirmar ? '<p class="tenue">Espera un minuto y pulsa «Actualizar» para ver si se guardó, antes de volver a marcar.</p>' : ''}
      ${pendientes.length ? `<div class="tabla-scroll cie-tabla"><table>
        <thead><tr><th>Hecho</th><th>Nº</th><th>Partner</th><th>Cliente</th><th>Dirección</th><th>Cierre</th><th>Equipo</th><th>Cargador</th><th>Días</th><th>Nota</th><th>Boletín</th></tr></thead>
        <tbody>${pendientes.map(filaPendiente).join('')}</tbody>
      </table></div>`
        : '<div class="tarjeta bloque"><p style="margin:0"><strong>No hay ningún CIE pendiente.</strong></p></div>'}
      <details class="cie-hechos" ${hechosAbierto ? 'open' : ''}>
        <summary>Hechos (${hechos.length})</summary>
        ${hechos.length ? `<div class="tabla-scroll cie-tabla"><table>
          <thead><tr><th>Nº</th><th>Partner</th><th>Cliente</th><th>Dirección</th><th>Cierre</th><th>Equipo</th><th>Cargador</th><th>Hecho el</th><th>Origen</th><th>Quién</th><th>Nota</th><th></th></tr></thead>
          <tbody>${hechos.map(filaHecho).join('')}</tbody>
        </table></div>` : '<p class="tenue">Todavía no hay ninguno.</p>'}
      </details>`;
  }

  // `ocupado: true` (BACKEND.md): no se ha guardado nada; se reintenta UNA vez pasados unos segundos
  async function marcar(nums, hecho, nota) {
    try { return await api.marcarCie(nums, hecho, nota); }
    catch (e) {
      if (!e.ocupado || e.sinConfirmar) throw e;
      reintentando = true; pintar();
      await pausa(ESPERA_OCUPADO_MS);
      try { return await api.marcarCie(nums, hecho, nota); } finally { reintentando = false; }
    } finally { reintentando = false; }
  }
  function aplicar(r) {
    if (r.vista && Array.isArray(r.vista.pendientes)) vista = r.vista;
    if (Array.isArray(r.sinCambio) && r.sinCambio.length) avisar(`Ya estaban así: ${r.sinCambio.join(', ')}.`, 'info');
    if (!r.vista) recargar();
  }

  // Sale lo marcado hasta ahora en una petición; lo que se marque mientras tanto va en la siguiente
  async function enviar() {
    clearTimeout(temporizador); temporizador = null;
    if (enCurso || !marcadas.size) return;
    const nums = [...marcadas].slice(0, MAX_POR_PETICION);
    nums.forEach(n => { marcadas.delete(n); enviando.add(n); });
    enCurso = true; errorMarca = null;
    pintar();
    try {
      aplicar(await marcar(nums, true, ''));
    } catch (e) {
      // No se ha guardado (o no se sabe): las filas vuelven a pendientes en pantalla y se dice por qué
      errorMarca = e;
      if (!vivo) avisar(`No se han podido marcar los CIE (${nums.join(', ')}): ${e.message}`, 'error');
    } finally {
      nums.forEach(n => enviando.delete(n));
      enCurso = false;
      pintar();
      if (marcadas.size) enviar();
    }
  }

  async function deshacer(num) {
    const form = await preguntar(`Devolver ${num} a pendientes`,
      `<p>El CIE de esta obra volverá a la lista de pendientes.</p>
       <label>Nota (opcional)<input type="text" name="nota" maxlength="${MAX_NOTA}" placeholder="p. ej. hay que rehacerlo"></label>`,
      { aceptar: 'Deshacer' });
    if (!form || !vivo) return;
    const nota = String(new FormData(form).get('nota') || '').trim();
    enviando.add(num); errorMarca = null;
    pintar();
    try { aplicar(await marcar([num], false, nota)); }
    catch (e) { errorMarca = e; }
    finally { enviando.delete(num); pintar(); }
  }

  function alCambiar(ev) {
    const casilla = ev.target.closest('input[data-num]');
    if (!casilla) return;
    if (casilla.checked) marcadas.add(casilla.dataset.num); else marcadas.delete(casilla.dataset.num);
    clearTimeout(temporizador);
    temporizador = marcadas.size ? setTimeout(enviar, ESPERA_AGRUPAR_MS) : null;
    pintar();
    // Tras repintar, el foco vuelve a la casilla para poder seguir con el teclado
    el.querySelector(`input[data-num="${CSS.escape(casilla.dataset.num)}"]`)?.focus();
  }
  function alPulsar(ev) {
    if (ev.target.closest('[data-accion="recargar"]')) { recargar(); return; }
    const d = ev.target.closest('[data-deshacer]');
    if (d) deshacer(d.dataset.deshacer);
  }
  // `toggle` no burbujea: se escucha en captura para recordar si «Hechos» está abierto al repintar
  function alPlegar(ev) { if (ev.target.matches?.('details.cie-hechos')) hechosAbierto = ev.target.open; }

  el.addEventListener('change', alCambiar);
  el.addEventListener('click', alPulsar);
  el.addEventListener('toggle', alPlegar, true);
  recargar();

  return {
    recargar,
    desmontar() {
      // Lo marcado y aún sin enviar sale ahora: no se pierde por cambiar de pantalla
      el.removeEventListener('change', alCambiar);
      el.removeEventListener('click', alPulsar);
      el.removeEventListener('toggle', alPlegar, true);
      vivo = false;
      if (marcadas.size) enviar();
    },
  };
}
