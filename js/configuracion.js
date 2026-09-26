// Pantalla de configuración: festivos (solo consulta: mandan en Holded) y precios de coste de material (editables).
import * as api from './api.js?v=25';
import { ayuda, AYUDA } from './ayudas.js?v=25';
import { esc, eur, fecha, hoy, leerImporte, importeEditable, avisar, preguntar, cajaError, listaAvisos } from './ui.js?v=25';

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const diaSemana = iso => new Date(iso + 'T12:00').getDay();
const esFinde = iso => [0, 6].includes(diaSemana(iso));

export function montar(el) {
  let anio = hoy().slice(0, 4);
  let festivos = null, errorFestivos = null;
  let familias = null, errorPrecios = null;
  // Precios editados y aún sin guardar: id → { coste (texto), notas }
  let borrador = new Map();
  let guardandoPrecios = false, errorGuardado = null;

  async function cargarFestivos() {
    errorFestivos = null;
    try { festivos = (await api.leerFestivos(anio)).festivos || []; } catch (e) { errorFestivos = e; }
    pintar();
  }
  async function cargarPrecios() {
    errorPrecios = null;
    try { familias = (await api.leerPrecios()).familias || []; } catch (e) { errorPrecios = e; }
    pintar();
  }
  function recargar() { pintar(); cargarFestivos(); cargarPrecios(); }   // la cola del api.js las manda de una en una

  const concepto = id => (familias || []).flatMap(f => f.conceptos || []).find(c => c.id === id);
  // Cambios reales frente a lo que hay en el servidor; los que vuelven al valor original no cuentan
  function cambios() {
    const lista = [], errores = [];
    for (const [id, b] of borrador) {
      const c = concepto(id);
      if (!c) continue;
      const coste = leerImporte(b.coste);
      if (coste === null || Number.isNaN(coste) || coste < 0) { errores.push(c.concepto); continue; }
      const cambioCoste = Math.round(coste * 100) !== Math.round(Number(c.coste) * 100);
      const cambioNotas = (b.notas ?? '') !== (c.notas ?? '');
      if (cambioCoste || cambioNotas) lista.push({ id, coste, ...(cambioNotas ? { notas: b.notas } : {}) });
    }
    return { lista, errores };
  }

  // ── Precios ──
  async function guardarPrecios() {
    const { lista, errores } = cambios();
    if (errores.length) { avisar(`Revisa el coste de: ${errores.join(', ')}. No es un importe válido.`, 'error'); return; }
    if (!lista.length) return;
    const ok = await preguntar('Guardar precios',
      `<p>Vas a cambiar <strong>${lista.length} precio${lista.length === 1 ? '' : 's'}</strong>.</p>
       <p class="caja-aviso">El cambio recalcula el coste de material de <strong>todas las instalaciones</strong> del Registro, también las ya cerradas.</p>`,
      { aceptar: 'Guardar cambios' });
    if (!ok) return;
    guardandoPrecios = true; errorGuardado = null; pintar();
    try {
      const r = await api.guardarPrecios(lista);
      listaAvisos(r.avisos, 15000);
      avisar(`${r.guardados ?? lista.length} precio${(r.guardados ?? lista.length) === 1 ? '' : 's'} guardado${(r.guardados ?? lista.length) === 1 ? '' : 's'}.`);
      borrador = new Map();
      guardandoPrecios = false;
      await cargarPrecios();
      return;
    } catch (e) { errorGuardado = e; }
    guardandoPrecios = false; pintar();
  }

  // ── Pintado ──
  function bloqueFestivos() {
    if (errorFestivos && !festivos) return cajaError(errorFestivos, 'No se han podido cargar los festivos') + '<button class="boton" data-accion="recargar-festivos">Reintentar</button>';
    if (!festivos) return '<p class="cargando">Cargando festivos…</p>';
    const lista = [...festivos].sort((a, b) => a.fecha.localeCompare(b.fecha));
    const enFinde = lista.filter(f => esFinde(f.fecha)).length;
    return `
      <p class="caja-aviso">Los festivos se gestionan en el calendario laboral de Holded. Aquí solo se consultan: los del centro de trabajo que tenga Holded se añaden solos (ámbito «Holded»).</p>
      <p class="tenue">${lista.length} festivo${lista.length === 1 ? '' : 's'} en ${esc(anio)}${enFinde ? `, ${enFinde} en fin de semana (no restan días laborables)` : ''}.</p>
      <div class="tabla-scroll"><table>
        <thead><tr><th>Fecha</th><th>Día</th><th>Nombre</th><th>Ámbito</th></tr></thead>
        <tbody>${lista.map(f => `<tr class="${f.fecha < hoy() ? 'baja' : ''}">
          <td>${fecha(f.fecha)}</td>
          <td>${DIAS[diaSemana(f.fecha)]}${esFinde(f.fecha) ? ' <span class="insignia aviso" title="Un festivo en fin de semana no resta días laborables">fin de semana</span>' : ''}</td>
          <td><strong>${esc(f.nombre)}</strong></td>
          <td>${f.ambito === 'Holded' ? '<span class="insignia holded" title="Del calendario laboral del centro de trabajo en Holded">Holded</span>' : esc(f.ambito || '—')}</td>
        </tr>`).join('') || '<tr><td colspan="4" class="vacio">No hay festivos en este año.</td></tr>'}</tbody>
      </table></div>`;
  }

  const textoCambios = n => n ? `<strong>${n} cambio${n === 1 ? '' : 's'} sin guardar.</strong>` : '<span class="tenue">Sin cambios.</span>';
  const textoAntes = (c, lista) => {
    const x = lista.find(k => k.id === c.id);
    return x && Math.round(x.coste * 100) !== Math.round(Number(c.coste) * 100) ? `antes ${eur(c.coste)}` : '';
  };
  // Mientras se escribe no se repinta la tabla (se perdería un clic en «Guardar»): solo la fila y la barra
  function actualizarPrecios(input) {
    const { lista } = cambios();
    const fila = input.closest('tr'), c = concepto(input.dataset.precio);
    fila.classList.toggle('fila-cambiada', lista.some(k => k.id === c.id));
    fila.querySelector('.antes').textContent = textoAntes(c, lista);
    el.querySelector('#resumen-precios').innerHTML = textoCambios(lista.length);
    for (const a of ['guardar-precios', 'descartar-precios']) el.querySelector(`[data-accion="${a}"]`).disabled = !lista.length || guardandoPrecios;
  }

  function bloquePrecios() {
    if (errorPrecios && !familias) return cajaError(errorPrecios, 'No se han podido cargar los precios') + '<button class="boton" data-accion="recargar-precios">Reintentar</button>';
    if (!familias) return '<p class="cargando">Cargando precios…</p>';
    const { lista } = cambios();
    const cambiado = id => lista.some(c => c.id === id);
    return `
      <div class="caja-aviso">Cambiar un precio <strong>recalcula el coste de material de todas las instalaciones</strong> (columna AJ del Registro). El identificador y el concepto no se pueden cambiar aquí: los usan el tarifario y la exportación a Holded.</div>
      ${errorGuardado ? cajaError(errorGuardado, 'El servidor no ha aceptado los precios') : ''}
      <div class="barra" style="align-items:center">
        <span id="resumen-precios">${textoCambios(lista.length)}</span>
        <span class="empuje"></span>
        <button class="boton secundario" data-accion="descartar-precios" ${lista.length && !guardandoPrecios ? '' : 'disabled'}>Descartar</button>
        <button class="boton" data-accion="guardar-precios" ${lista.length && !guardandoPrecios ? '' : 'disabled'}>${guardandoPrecios ? 'Guardando…' : 'Guardar cambios'}</button>
      </div>
      <div class="tabla-scroll"><table class="tabla-precios">
        <thead><tr><th>Id.</th><th>Concepto</th><th class="num">Coste €/ud ${ayuda(AYUDA.costeUnidad)}</th><th>Notas</th></tr></thead>
        ${familias.map(f => `<tbody>
          <tr class="familia"><th colspan="4">${esc(f.titulo)}</th></tr>
          ${(f.conceptos || []).map(c => {
            const b = borrador.get(c.id);
            return `<tr class="${cambiado(c.id) ? 'fila-cambiada' : ''}">
              <td><code>${esc(c.id)}</code></td><td>${esc(c.concepto)}</td>
              <td class="num"><input class="importe" inputmode="decimal" data-precio="${esc(c.id)}" data-campo="coste" value="${esc(b ? b.coste : importeEditable(c.coste))}" aria-label="Coste de ${esc(c.concepto)}"> €
                <div class="antes">${textoAntes(c, lista)}</div></td>
              <td><input class="notas" data-precio="${esc(c.id)}" data-campo="notas" value="${esc(b ? b.notas : (c.notas || ''))}" maxlength="200" aria-label="Notas de ${esc(c.concepto)}"></td>
            </tr>`;
          }).join('')}
        </tbody>`).join('') || '<tbody><tr><td colspan="4" class="vacio">No hay precios.</td></tr></tbody>'}
      </table></div>`;
  }

  function pintar() {
    // Conserva el foco y el cursor al repintar mientras se escribe un precio
    const activo = document.activeElement?.dataset?.precio ? { id: document.activeElement.dataset.precio, campo: document.activeElement.dataset.campo, pos: document.activeElement.selectionStart } : null;
    el.innerHTML = `
      <div class="barra"><div><h1>Configuración</h1><p class="tenue">Festivos (solo consulta) y precios de coste de material. Los precios que guardes aquí sustituyen a escribir en ⚙️ Configuración del Sheets.</p></div></div>
      <section class="bloque">
        <div class="barra" style="align-items:end;margin-bottom:.75rem">
          <div><h2 style="margin:0">Festivos ${ayuda(AYUDA.festivos)}</h2><p class="tenue" style="margin:0">Cuentan para los días laborables de capacidad, rendimiento y ausencias.</p></div>
          <span class="empuje"></span>
          <label>Año<select id="anio">${[...new Set([-1, 0, 1].map(d => String(Number(hoy().slice(0, 4)) + d)).concat(anio))].sort().map(a => `<option ${a === anio ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
        </div>
        ${bloqueFestivos()}
      </section>
      <section class="bloque">
        <h2>Precios de coste de material ${ayuda(AYUDA.precios)}</h2>
        ${bloquePrecios()}
      </section>`;
    if (activo) {
      const i = el.querySelector(`[data-precio="${CSS.escape(activo.id)}"][data-campo="${activo.campo}"]`);
      if (i) { i.focus(); try { i.setSelectionRange(activo.pos, activo.pos); } catch { /* nada */ } }
    }
  }

  // ── Eventos ──
  function alEscribir(ev) {
    const t = ev.target;
    if (!t.dataset.precio) return;
    const c = concepto(t.dataset.precio);
    const b = borrador.get(t.dataset.precio) || { coste: importeEditable(c.coste), notas: c.notas || '' };
    b[t.dataset.campo] = t.value;
    borrador.set(t.dataset.precio, b);
    actualizarPrecios(t);
  }
  function alCambiar(ev) {
    const t = ev.target;
    if (t.id === 'anio') { anio = t.value; festivos = null; pintar(); cargarFestivos(); }
  }
  function alPulsar(ev) {
    const b = ev.target.closest('[data-accion]');
    if (!b) return;
    const a = b.dataset.accion;
    if (a === 'recargar-festivos') cargarFestivos();
    if (a === 'recargar-precios') cargarPrecios();
    if (a === 'guardar-precios') guardarPrecios();
    if (a === 'descartar-precios') { borrador = new Map(); errorGuardado = null; pintar(); }
  }
  const eventos = { input: alEscribir, change: alCambiar, click: alPulsar };
  Object.entries(eventos).forEach(([k, fn]) => el.addEventListener(k, fn));
  recargar();

  return {
    pendiente: () => cambios().lista.length > 0,
    recargar,
    desmontar: () => Object.entries(eventos).forEach(([k, fn]) => el.removeEventListener(k, fn)),
  };
}
