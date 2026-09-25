// Pantalla de configuración: festivos y precios de coste de material, para no tener que escribir en el Sheets.
import * as api from './api.js?v=23';
import { esc, eur, fecha, hoy, leerImporte, importeEditable, avisar, preguntar, cajaError, listaAvisos } from './ui.js?v=23';

const AMBITOS = ['Nacional', 'Comunidad de Madrid', 'Local'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const diaSemana = iso => new Date(iso + 'T12:00').getDay();
const esFinde = iso => [0, 6].includes(diaSemana(iso));

export function montar(el) {
  let anio = hoy().slice(0, 4);
  let festivos = null, errorFestivos = null;
  let familias = null, errorPrecios = null;
  // Precios editados y aún sin guardar: id → { coste (texto), notas }
  let borrador = new Map();
  let guardandoPrecios = false, errorGuardado = null, guardandoFestivo = false;

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

  // ── Festivos ──
  const camposFestivo = v => `
    <label>Fecha<input type="date" name="fecha" value="${esc(v.fecha || '')}" required></label>
    <label>Nombre<input name="nombre" value="${esc(v.nombre || '')}" required maxlength="80"></label>
    <label>Ámbito<input name="ambito" list="ambitos" value="${esc(v.ambito || 'Nacional')}" maxlength="60"></label>
    <datalist id="ambitos">${AMBITOS.map(a => `<option value="${esc(a)}">`).join('')}</datalist>`;

  const avisoFinde = f => esFinde(f) ? ` Cae en ${DIAS[diaSemana(f)]}: no resta días laborables.` : '';

  async function guardarFestivo(v) {
    const r = await api.guardarFestivo({ ...(v.fechaAnterior ? { fechaAnterior: v.fechaAnterior } : {}), fecha: v.fecha, nombre: v.nombre.trim(), ambito: (v.ambito || '').trim() });
    listaAvisos(r.avisos);
    const f = r.festivo || v;
    avisar(`${v.fechaAnterior ? 'Festivo corregido' : 'Festivo añadido'}: ${f.nombre}, ${fecha(f.fecha)}.${avisoFinde(f.fecha)}`, esFinde(f.fecha) ? 'aviso' : 'info', 8000);
  }

  async function editarFestivo(f) {
    let v = { ...f, fechaAnterior: f.fecha }, error = null;
    for (;;) {
      const form = await preguntar('Corregir festivo', (error ? cajaError(error, 'No se ha guardado') : '') + camposFestivo(v), { aceptar: 'Guardar' });
      if (!form) return;
      v = { ...v, ...Object.fromEntries(new FormData(form)) };
      if (!v.fecha || !v.nombre.trim()) { error = new Error('Faltan la fecha o el nombre.'); continue; }
      try { await guardarFestivo(v); await cargarFestivos(); return; } catch (e) { error = e; }
    }
  }

  async function borrarFestivo(f) {
    const ok = await preguntar('Borrar festivo',
      `<p>¿Borrar <strong>${esc(f.nombre)}</strong> (${fecha(f.fecha)})?</p><p class="tenue">Ese día volverá a contar como laborable en capacidad, rendimiento y ausencias.</p>`,
      { aceptar: 'Borrar', peligro: true });
    if (!ok) return;
    try { await api.borrarFestivo(f.fecha); avisar('Festivo borrado.'); await cargarFestivos(); }
    catch (e) { avisar(e.message, 'error'); }
  }

  async function altaFestivo(form) {
    const v = Object.fromEntries(new FormData(form));
    if (!v.fecha || !v.nombre.trim()) { avisar('Faltan la fecha o el nombre del festivo.', 'error'); return; }
    if ((festivos || []).some(f => f.fecha === v.fecha)) { avisar(`Ya hay un festivo el ${fecha(v.fecha)}.`, 'error'); return; }
    guardandoFestivo = true; pintar();
    try {
      await guardarFestivo(v);
      if (v.fecha.slice(0, 4) !== anio) anio = v.fecha.slice(0, 4);   // se ve el año del festivo añadido
      guardandoFestivo = false;
      await cargarFestivos();
      return;
    } catch (e) { avisar(e.message, 'error', 12000); }
    guardandoFestivo = false; pintar();
    const f = el.querySelector('#alta-festivo');
    if (f) for (const [k, val] of Object.entries(v)) if (f.elements[k]) f.elements[k].value = val;
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
      <form class="fila-campos alta-festivo" id="alta-festivo" autocomplete="off">
        <label>Fecha<input type="date" name="fecha" required></label>
        <label class="ancho">Nombre<input name="nombre" required maxlength="80" placeholder="San Isidro"></label>
        <label>Ámbito<input name="ambito" list="ambitos-alta" value="Nacional" maxlength="60"></label>
        <datalist id="ambitos-alta">${AMBITOS.map(a => `<option value="${esc(a)}">`).join('')}</datalist>
        <button class="boton" type="submit" ${guardandoFestivo ? 'disabled' : ''}>${guardandoFestivo ? 'Guardando…' : 'Añadir festivo'}</button>
      </form>
      <p class="tenue">${lista.length} festivo${lista.length === 1 ? '' : 's'} en ${esc(anio)}${enFinde ? `, ${enFinde} en fin de semana (no restan días laborables)` : ''}.</p>
      <div class="tabla-scroll"><table>
        <thead><tr><th>Fecha</th><th>Día</th><th>Nombre</th><th>Ámbito</th><th></th></tr></thead>
        <tbody>${lista.map(f => `<tr class="${f.fecha < hoy() ? 'baja' : ''}">
          <td>${fecha(f.fecha)}</td>
          <td>${DIAS[diaSemana(f.fecha)]}${esFinde(f.fecha) ? ' <span class="insignia aviso" title="Un festivo en fin de semana no resta días laborables">fin de semana</span>' : ''}</td>
          <td><strong>${esc(f.nombre)}</strong></td><td>${esc(f.ambito || '—')}</td>
          <td class="num"><div class="botones-tipo" style="justify-content:flex-end">
            <button class="boton secundario mini" data-accion="editar-festivo" data-fecha="${esc(f.fecha)}">Corregir</button>
            <button class="boton peligro mini" data-accion="borrar-festivo" data-fecha="${esc(f.fecha)}">Borrar</button></div></td>
        </tr>`).join('') || '<tr><td colspan="5" class="vacio">No hay festivos en este año.</td></tr>'}</tbody>
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
        <thead><tr><th>Id.</th><th>Concepto</th><th class="num">Coste €/ud</th><th>Notas</th></tr></thead>
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
      <div class="barra"><div><h1>Configuración</h1><p class="tenue">Festivos y precios de coste de material. Lo que guardes aquí sustituye a escribir en ⚙️ Configuración del Sheets.</p></div></div>
      <section class="bloque">
        <div class="barra" style="align-items:end;margin-bottom:.75rem">
          <div><h2 style="margin:0">Festivos</h2><p class="tenue" style="margin:0">Cuentan para los días laborables de capacidad, rendimiento y ausencias.</p></div>
          <span class="empuje"></span>
          <label>Año<select id="anio">${[...new Set([-1, 0, 1].map(d => String(Number(hoy().slice(0, 4)) + d)).concat(anio))].sort().map(a => `<option ${a === anio ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
        </div>
        ${bloqueFestivos()}
      </section>
      <section class="bloque">
        <h2>Precios de coste de material</h2>
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
    const festivo = () => festivos.find(f => f.fecha === b.dataset.fecha);
    if (a === 'recargar-festivos') cargarFestivos();
    if (a === 'recargar-precios') cargarPrecios();
    if (a === 'editar-festivo' && festivo()) editarFestivo(festivo());
    if (a === 'borrar-festivo' && festivo()) borrarFestivo(festivo());
    if (a === 'guardar-precios') guardarPrecios();
    if (a === 'descartar-precios') { borrador = new Map(); errorGuardado = null; pintar(); }
  }
  function alEnviar(ev) {
    if (ev.target.id !== 'alta-festivo') return;
    ev.preventDefault();
    altaFestivo(ev.target);
  }
  const eventos = { input: alEscribir, change: alCambiar, click: alPulsar, submit: alEnviar };
  Object.entries(eventos).forEach(([k, fn]) => el.addEventListener(k, fn));
  recargar();

  return {
    pendiente: () => cambios().lista.length > 0,
    recargar,
    desmontar: () => Object.entries(eventos).forEach(([k, fn]) => el.removeEventListener(k, fn)),
  };
}
