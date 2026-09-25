// Pantalla de ausencias: sustituye a escribir a mano en «⏱️ Ausencias» del Sheets.
// Se lee el año entero una vez (para el saldo de vacaciones) y el mes se filtra aquí.
import * as api from './api.js?v=23';
import { esc, fecha, hoy, mesActual, nombreMes, avisar, preguntar, cajaError, listaAvisos } from './ui.js?v=23';

// Días de vacaciones al año según convenio (BACKEND.md). Solo sirve para enseñar cuántos quedan.
const VACACIONES_ANUALES = 22;
const esVacaciones = motivo => /vacacion/i.test(String(motivo || ''));
// Color estable por motivo, para el calendario
const COLORES = ['#3B5BF0', '#12B3A0', '#E39A1B', '#F0609A', '#7C6CF6', '#1F8FD6', '#4E9E3A', '#D9467A'];
const DIAS_SEMANA = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

// Holded es la fuente oficial (BACKEND.md v3.20.38): el backend copia cada mañana las ausencias aceptadas.
// Esas son de solo consulta; el alta manual queda para lo excepcional.
const esHolded = a => a.origen === 'holded' || (!a.origen && /^H/.test(String(a.id || '')));
const NOTA_HOLDED = 'Se gestionan en Holded · se actualizan cada mañana (7:00).';

const dos = n => String(n).padStart(2, '0');
const diasDelMes = mes => { const [a, m] = mes.split('-').map(Number); return new Date(a, m, 0).getDate(); };
const diaSemana = iso => new Date(iso + 'T12:00').getDay();

export function montar(el) {
  let mes = mesActual();
  let anio = mes.slice(0, 4);
  let datos = null;            // respuesta de panelAusencias del año
  let errorCarga = null;
  let filtroTec = '', filtroMotivo = '';

  async function recargar() {
    errorCarga = null;
    pintar(true);
    try {
      datos = await api.leerAusencias(`${anio}-01-01`, `${anio}-12-31`);
    } catch (e) {
      errorCarga = e;
    }
    pintar();
  }

  const colorDe = motivo => COLORES[Math.max(0, (datos?.motivos || []).indexOf(motivo)) % COLORES.length];
  // Una ausencia cuyo nombre no casa con ningún empleado llega sin idTecnico (BACKEND.md v3.20.30):
  // se agrupa por su texto y se enseña aparte, para corregirla eligiendo el técnico.
  const claveTec = a => a.idTecnico || 'texto:' + (a.tecnico || '?');
  // Filas del calendario y del resumen: los activos, los de baja que tengan ausencias este año y los nombres sin casar
  function filas() {
    const conAusencias = new Set((datos?.ausencias || []).map(claveTec));
    const tecs = (datos?.tecnicos || []).filter(t => t.activo !== false || conAusencias.has(t.id))
      .map(t => ({ ...t, inactivo: t.activo === false }));
    const sinCasar = [...new Set((datos?.ausencias || []).filter(a => !a.idTecnico).map(a => a.tecnico || '?'))]
      .map(n => ({ id: 'texto:' + n, nombre: n, unidad: '', sinCasar: true }));
    return [...tecs, ...sinCasar];
  }
  const tecnicos = () => filas().filter(t => !filtroTec || t.id === filtroTec);
  const ausencias = () => (datos?.ausencias || [])
    .filter(a => (!filtroTec || claveTec(a) === filtroTec) && (!filtroMotivo || a.motivo === filtroMotivo));
  const delMes = () => ausencias().filter(a => a.desde <= `${mes}-31` && a.hasta >= `${mes}-01`)
    .sort((a, b) => a.desde.localeCompare(b.desde) || String(a.tecnico).localeCompare(b.tecnico));
  const nombreTec = id => datos?.tecnicos?.find(t => t.id === id)?.nombre || id;

  // Días laborables por técnico en el año, por motivo. La ausencia cuenta en el año en que empieza.
  function resumenAnual() {
    const r = new Map();
    for (const a of datos?.ausencias || []) {
      if (a.desde.slice(0, 4) !== anio) continue;
      const t = r.get(claveTec(a)) || { vacaciones: 0, otros: new Map() };
      const n = Number(a.diasLaborables || 0);
      if (esVacaciones(a.motivo)) t.vacaciones += n;
      else t.otros.set(a.motivo, (t.otros.get(a.motivo) || 0) + n);
      r.set(claveTec(a), t);
    }
    return r;
  }

  // ── Formulario (alta y edición) en el diálogo ──
  const campos = v => `
    <label>Técnico<select name="idTecnico" required>
      <option value="">— Elige —</option>
      ${(datos.tecnicos || []).filter(t => t.activo !== false || t.id === v.idTecnico).map(t => `<option value="${esc(t.id)}" ${t.id === v.idTecnico ? 'selected' : ''}>${esc(t.nombre)}${t.unidad ? ' · ' + esc(t.unidad) : ''}${t.activo === false ? ' (de baja)' : ''}</option>`).join('')}
    </select></label>
    ${v.id && !v.idTecnico ? `<p class="caja-aviso">En la hoja pone «${esc(v.tecnico || '?')}», que no coincide con ningún empleado. Elige el técnico para corregirla.</p>` : ''}
    <div class="fila-campos">
      <label>Desde<input type="date" name="desde" value="${esc(v.desde || '')}" required></label>
      <label>Hasta (incluido)<input type="date" name="hasta" value="${esc(v.hasta || '')}" required></label>
    </div>
    <label>Motivo<select name="motivo" required>
      <option value="">— Elige —</option>
      ${(datos.motivos || []).map(m => `<option ${m === v.motivo ? 'selected' : ''}>${esc(m)}</option>`).join('')}
    </select></label>
    <label>Notas (opcional)<input name="notas" value="${esc(v.notas || '')}" maxlength="200"></label>
    ${v.id ? '' : '<p class="caja-aviso">Solo para lo que no se registre en Holded. Si después se registra en Holded, la de Holded sustituirá a esta.</p>'}`;

  function validar(v) {
    if (!v.idTecnico || !v.desde || !v.hasta || !v.motivo) return 'Faltan datos: técnico, desde, hasta y motivo.';
    if (v.hasta < v.desde) return 'La fecha «hasta» no puede ser anterior a «desde».';
    return null;
  }

  async function guardar(v) {
    const r = await api.guardarAusencia({ ...(v.id ? { id: v.id } : {}), idTecnico: v.idTecnico, desde: v.desde, hasta: v.hasta, motivo: v.motivo, notas: (v.notas || '').trim() });
    listaAvisos(r.avisos);
    const a = r.ausencia || v;
    avisar(`${v.id ? 'Ausencia corregida' : 'Ausencia guardada'}: ${nombreTec(a.idTecnico)}, ${a.motivo.toLowerCase()} del ${fecha(a.desde)} al ${fecha(a.hasta)}${a.diasLaborables != null ? ` (${a.diasLaborables} día${a.diasLaborables === 1 ? '' : 's'} laborable${a.diasLaborables === 1 ? '' : 's'})` : ''}.`);
  }

  // Abre el diálogo; si el servidor rechaza (p. ej. un solape), se vuelve a abrir con lo escrito y el motivo
  async function editar(inicial) {
    if (esHolded(inicial)) return verHolded(inicial);
    let v = { ...inicial }, error = null;
    for (;;) {
      const form = await preguntar(v.id ? 'Corregir ausencia' : 'Añadir ausencia fuera de Holded',
        (error ? cajaError(error, 'No se ha guardado') : '') + campos(v), { aceptar: 'Guardar' });
      if (!form) return;
      v = { ...v, ...Object.fromEntries(new FormData(form)) };
      const falta = validar(v);
      if (falta) { error = new Error(falta); continue; }
      try { await guardar(v); await recargar(); return; } catch (e) { error = e; }
    }
  }

  async function borrar(a) {
    const ok = await preguntar('Borrar ausencia',
      `<p>¿Borrar la ausencia de <strong>${esc(a.tecnico || nombreTec(a.idTecnico))}</strong>: ${esc(a.motivo)} del ${fecha(a.desde)} al ${fecha(a.hasta)}?</p>
       <p class="tenue">Los costes de ese periodo se recalcularán solos.</p>`,
      { aceptar: 'Borrar', peligro: true });
    if (!ok) return;
    try {
      await api.borrarAusencia(a.id);
      avisar('Ausencia borrada.');
      await recargar();
    } catch (e) {
      avisar(e.message, 'error');
    }
  }

  // Las de Holded solo se consultan: se cambian o se anulan en Holded
  function verHolded(a) {
    return preguntar('Ausencia de Holded',
      `<p><strong>${esc(a.tecnico || nombreTec(a.idTecnico))}</strong>: ${esc(a.motivo)} del ${fecha(a.desde)} al ${fecha(a.hasta)}${a.diasLaborables != null ? ` (${a.diasLaborables} día${a.diasLaborables === 1 ? '' : 's'} laborable${a.diasLaborables === 1 ? '' : 's'})` : ''}.</p>
       ${a.notas ? `<p class="tenue">${esc(a.notas)}</p>` : ''}
       <p class="caja-aviso">Esta ausencia viene de Holded. Para cambiarla o anularla, hazlo en Holded: aquí se actualiza cada mañana a las 7:00.</p>`,
      { aceptar: 'Entendido', cancelar: 'Cerrar' });
  }

  // ── Pintado ──
  function calendario() {
    const n = diasDelMes(mes);
    const dias = Array.from({ length: n }, (_, i) => `${mes}-${dos(i + 1)}`);
    const tecs = tecnicos();
    const deTec = id => ausencias().filter(a => claveTec(a) === id && a.desde <= `${mes}-${dos(n)}` && a.hasta >= `${mes}-01`);
    return `<div class="tabla-scroll calendario"><table>
      <thead><tr><th class="cal-tec">Técnico</th>${dias.map(d => {
        const s = diaSemana(d), finde = s === 0 || s === 6;
        return `<th class="cal-dia ${finde ? 'finde' : ''} ${d === hoy() ? 'hoy' : ''}"><span>${DIAS_SEMANA[s]}</span>${Number(d.slice(8))}</th>`;
      }).join('')}</tr></thead>
      <tbody>${tecs.map(t => {
        const suyas = deTec(t.id);
        return `<tr class="${t.sinCasar ? 'sin-casar' : ''}"><th class="cal-tec" scope="row">${esc(t.nombre)}${t.sinCasar ? '<small class="error">no coincide con ningún empleado</small>' : t.inactivo ? '<small>de baja</small>' : t.unidad ? `<small>${esc(t.unidad)}</small>` : ''}</th>${dias.map(d => {
          const s = diaSemana(d), finde = s === 0 || s === 6;
          const a = suyas.find(x => x.desde <= d && x.hasta >= d);
          if (!a) return t.sinCasar || t.inactivo ? `<td class="cal-celda ${finde ? 'finde' : ''} inerte"></td>`
            : `<td class="cal-celda ${finde ? 'finde' : ''}" data-accion="nueva-en" data-tec="${esc(t.id)}" data-dia="${d}" title="Añadir ausencia a ${esc(t.nombre)} el ${fecha(d)}"></td>`;
          return `<td class="cal-celda con ${finde ? 'finde' : ''} ${esHolded(a) ? 'holded' : 'manual'}" style="--c:${colorDe(a.motivo)}" data-accion="editar" data-id="${esc(a.id)}"
            title="${esHolded(a) ? 'Holded · ' : 'Fuera de Holded · '}${esc(a.motivo)} · ${fecha(a.desde)} a ${fecha(a.hasta)}${a.notas ? ' · ' + esc(a.notas) : ''}"></td>`;
        }).join('')}</tr>`;
      }).join('') || `<tr><td colspan="${n + 1}" class="vacio">No hay técnicos.</td></tr>`}</tbody>
    </table></div>
    <div class="leyenda">${(datos.motivos || []).map(m => `<span><i style="background:${colorDe(m)}"></i>${esc(m)}</span>`).join('')}
      <span><i class="marca-manual"></i>Fuera de Holded</span>
      <span class="tenue">Pulsa una ausencia para verla. Las añadidas fuera de Holded se pueden corregir; en un día vacío se añade una.</span></div>`;
  }

  function pintar(cargando = false) {
    const cabecera = `<div class="barra">
        <div><h1>Ausencias</h1><p class="tenue">Vacaciones, permisos y bajas. Los días laborables los calcula el servidor (de lunes a viernes, sin festivos) y los costes se recalculan solos.</p></div>
        <span class="empuje"></span>
        <label>Mes<input type="month" id="mes" value="${esc(mes)}" required></label>
      </div>
      <div class="caja-aviso aviso-holded"><div><strong>Las ausencias se registran en Holded.</strong> ${NOTA_HOLDED} Aquí se consultan; solo lo excepcional se añade a mano.</div>
        ${datos ? '<button class="boton secundario" data-accion="nueva">Añadir ausencia fuera de Holded</button>' : ''}</div>`;
    if (cargando && !datos) { el.innerHTML = cabecera + '<p class="cargando">Cargando ausencias…</p>'; return; }
    if (errorCarga && !datos) {
      el.innerHTML = cabecera + cajaError(errorCarga, 'No se han podido cargar las ausencias') + '<button class="boton" data-accion="recargar">Reintentar</button>';
      return;
    }
    if (!datos) return;
    const lista = delMes();
    const resumen = resumenAnual();

    el.innerHTML = cabecera + `
      ${errorCarga ? cajaError(errorCarga, 'No se ha podido actualizar') : ''}

      <section class="bloque">
        <div class="barra" style="align-items:end;margin-bottom:.75rem">
          <h2 style="margin:0">${esc(nombreMes(mes))}</h2>
          <span class="empuje"></span>
          <label>Técnico<select id="filtro-tec"><option value="">Todos</option>
            ${filas().map(t => `<option value="${esc(t.id)}" ${t.id === filtroTec ? 'selected' : ''}>${esc(t.nombre)}${t.sinCasar ? ' (sin casar)' : t.inactivo ? ' (de baja)' : ''}</option>`).join('')}</select></label>
          <label>Motivo<select id="filtro-motivo"><option value="">Todos</option>
            ${(datos.motivos || []).map(m => `<option ${m === filtroMotivo ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
        </div>
        ${calendario()}
      </section>

      <section class="bloque">
        <h2>Ausencias de ${esc(nombreMes(mes))}</h2>
        <div class="tabla-scroll"><table>
          <thead><tr><th>Técnico</th><th>Equipo</th><th>Motivo</th><th>Desde</th><th>Hasta</th><th class="num">Días laborables</th><th>Notas</th><th></th></tr></thead>
          <tbody>${lista.map(a => `<tr>
            <td><strong>${esc(a.tecnico || nombreTec(a.idTecnico))}</strong>${a.idTecnico ? '' : ' <span class="insignia error" title="El nombre de la hoja no coincide con ningún empleado. Corrígela eligiendo el técnico.">sin casar</span>'}
              ${esHolded(a) ? '<span class="insignia holded" title="Se gestiona en Holded">Holded</span>' : '<span class="insignia" title="Añadida a mano en el panel">fuera de Holded</span>'}</td><td>${esc(a.equipo || '—')}</td>
            <td><span class="insignia motivo" style="--c:${colorDe(a.motivo)}">${esc(a.motivo)}</span></td>
            <td>${fecha(a.desde)}</td><td>${fecha(a.hasta)}</td><td class="num">${esc(a.diasLaborables ?? '—')}</td>
            <td class="tenue">${esc(a.notas || '')}</td>
            <td class="num">${esHolded(a) ? '<span class="tenue">Se cambia en Holded</span>' : `<div class="botones-tipo" style="justify-content:flex-end">
              <button class="boton secundario mini" data-accion="editar" data-id="${esc(a.id)}">Corregir</button>
              <button class="boton peligro mini" data-accion="borrar" data-id="${esc(a.id)}">Borrar</button></div>`}</td>
          </tr>`).join('') || '<tr><td colspan="8" class="vacio">No hay ausencias este mes con estos filtros.</td></tr>'}</tbody>
        </table></div>
      </section>

      <section class="bloque">
        <h2>Resumen de ${esc(anio)}</h2>
        <p class="tenue">Días laborables por técnico. Vacaciones: ${VACACIONES_ANUALES} al año según convenio. Una ausencia cuenta en el año en que empieza.</p>
        <div class="tabla-scroll"><table>
          <thead><tr><th>Técnico</th><th class="num">Vacaciones disfrutadas</th><th class="num">Le quedan</th><th>Otras ausencias</th></tr></thead>
          <tbody>${tecnicos().map(t => {
            const r = resumen.get(t.id) || { vacaciones: 0, otros: new Map() };
            const quedan = VACACIONES_ANUALES - r.vacaciones;
            return `<tr><td><strong>${esc(t.nombre)}</strong></td>
              <td class="num">${r.vacaciones}</td>
              <td class="num"><span class="insignia ${quedan < 0 ? 'error' : quedan <= 5 ? 'aviso' : 'ok'}">${quedan}</span></td>
              <td>${[...r.otros].map(([m, n]) => `<span class="insignia">${esc(m)}: ${n}</span>`).join(' ') || '<span class="tenue">—</span>'}</td></tr>`;
          }).join('')}</tbody>
        </table></div>
      </section>`;
  }

  // ── Eventos ──
  function alCambiar(ev) {
    const t = ev.target;
    if (t.id === 'mes' && t.value) {
      mes = t.value;
      if (mes.slice(0, 4) !== anio) { anio = mes.slice(0, 4); datos = null; recargar(); } else pintar();
    }
    if (t.id === 'filtro-tec') { filtroTec = t.value; pintar(); }
    if (t.id === 'filtro-motivo') { filtroMotivo = t.value; pintar(); }
  }
  function alPulsar(ev) {
    const b = ev.target.closest('[data-accion]');
    if (!b) return;
    const a = b.dataset.accion;
    const buscar = () => datos.ausencias.find(x => x.id === b.dataset.id);
    if (a === 'recargar') recargar();
    if (a === 'editar' && buscar()) editar(buscar());
    if (a === 'borrar' && buscar() && !esHolded(buscar())) borrar(buscar());
    if (a === 'nueva') editar({});
    if (a === 'nueva-en') editar({ idTecnico: b.dataset.tec, desde: b.dataset.dia, hasta: b.dataset.dia });
  }
  const eventos = { change: alCambiar, click: alPulsar };
  Object.entries(eventos).forEach(([k, fn]) => el.addEventListener(k, fn));
  recargar();

  return {
    recargar,
    desmontar: () => Object.entries(eventos).forEach(([k, fn]) => el.removeEventListener(k, fn)),
  };
}
