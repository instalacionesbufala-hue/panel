// Régimen de cada unidad: servicios al día y jornada, con fecha (BACKEND.md, encargo 4, v3.20.34).
// Cada fila vale desde su fecha hasta la siguiente de la misma unidad; sin filas, la unidad usa porDefecto.
import * as api from './api.js?v=22';
import { esc, fecha, hoy, avisar, preguntar, cajaError } from './ui.js?v=22';

export const leer = () => api.leerParametrosUnidades();

// Fila vigente en el día para la unidad; null si solo aplica el valor por defecto
export function vigenteEn(datos, unidad, dia) {
  return (datos?.parametros || []).filter(p => p.unidad === unidad && p.desde <= dia)
    .sort((a, b) => b.desde.localeCompare(a.desde))[0] || null;
}
export function regimenEn(datos, unidad, dia) {
  const p = vigenteEn(datos, unidad, dia);
  return p ? { ...p, porDefecto: false } : { ...(datos?.porDefecto || { servicios: 2, jornada: 462 }), porDefecto: true };
}
export const horas = min => {
  const m = Math.round(Number(min) || 0);
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
};
export const texto = r => `${r.servicios} servicio${r.servicios === 1 ? '' : 's'}/día · ${horas(r.jornada)}${r.horario ? ` (${r.horario})` : ''}`;

// «08:30-13:30» → minutos; null si no se entiende
function minutosDeHorario(desde, hasta) {
  const m = t => { const x = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return x ? Number(x[1]) * 60 + Number(x[2]) : null; };
  const a = m(desde), b = m(hasta);
  return a === null || b === null || b <= a ? null : b - a;
}

/** Abre el historial y el formulario «Cambiar a partir de…». Devuelve true si se guardó o borró algo. */
export async function abrir({ unidad, nombre, datos, dia }) {
  const historial = (datos?.parametros || []).filter(p => p.unidad === unidad).sort((a, b) => b.desde.localeCompare(a.desde));
  const actual = regimenEn(datos, unidad, dia);
  const [hDesde, hHasta] = String(actual.horario || '').split('-').map(s => s.trim());
  let v = { desde: dia > hoy() ? dia : hoy(), servicios: actual.servicios, horaDesde: hDesde || '', horaHasta: hHasta || '', jornada: actual.jornada, notas: '' };
  let error = null, cambiado = false;

  for (;;) {
    const cuerpo = `
      ${error ? cajaError(error, 'No se ha guardado') : ''}
      <p>Régimen el ${fecha(dia)}: <strong>${esc(texto(actual))}</strong>${actual.porDefecto ? ' <span class="insignia">por defecto</span>' : ` <span class="tenue">desde el ${fecha(actual.desde)}</span>`}</p>
      <p class="tenue">Capacidad del día = mín(servicios/día, técnicos presentes ese día). Jornada del día = jornada × capacidad ÷ servicios. Con eso se calculan el rendimiento, el aprovechamiento de jornada y los indicadores de la Dirección.</p>
      <details class="historial-regimen" ${historial.length ? 'open' : ''}><summary>Historial (${historial.length})</summary>
        ${historial.length ? `<table><thead><tr><th>Desde</th><th>Régimen</th><th>Notas</th><th></th></tr></thead><tbody>
          ${historial.map(p => `<tr><td>${fecha(p.desde)}</td><td>${esc(texto(p))}</td><td class="tenue">${esc(p.notas || '')}</td>
            <td class="num"><button type="submit" value="borrar" formnovalidate class="boton peligro mini" data-borrar-regimen="${esc(p.desde)}">Borrar</button></td></tr>`).join('')}
        </tbody></table>` : `<p class="tenue">Sin cambios registrados: usa el valor por defecto (${esc(texto({ ...datos?.porDefecto, horario: '' }))}).</p>`}
      </details>
      <fieldset class="cambio-regimen"><legend>Cambiar a partir de…</legend>
        <label>Fecha<input type="date" name="desde" value="${esc(v.desde)}" required></label>
        <label>Servicios al día<select name="servicios">${[0, 1, 2, 3, 4].map(n => `<option ${Number(v.servicios) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <div class="fila-campos">
          <label>Entrada<input type="time" name="horaDesde" value="${esc(v.horaDesde)}"></label>
          <label>Salida<input type="time" name="horaHasta" value="${esc(v.horaHasta)}"></label>
          <label>Jornada (min)<input type="number" name="jornada" min="1" max="720" step="1" value="${esc(v.jornada)}" required></label>
        </div>
        <p class="tenue" id="jornada-texto">${esc(horas(v.jornada))} al día. Con entrada y salida, la jornada se calcula sola.</p>
        <label>Notas<input name="notas" value="${esc(v.notas)}" maxlength="200" placeholder="Contrato reducido, nuevo vehículo…"></label>
      </fieldset>`;

    const pendiente = preguntar(`Régimen de ${nombre}`, cuerpo, { aceptar: 'Guardar cambio' });
    const dlg = document.getElementById('dialogo');
    // Entrada/salida → jornada en minutos, y borrado de filas del historial, dentro del mismo diálogo
    const alEditar = ev => {
      const f = dlg.querySelector('form');
      if (ev.target.name === 'horaDesde' || ev.target.name === 'horaHasta') {
        const min = minutosDeHorario(f.elements.horaDesde.value, f.elements.horaHasta.value);
        if (min) f.elements.jornada.value = Math.min(720, min);
      }
      if (['horaDesde', 'horaHasta', 'jornada'].includes(ev.target.name)) dlg.querySelector('#jornada-texto').textContent = `${horas(f.elements.jornada.value)} al día. Con entrada y salida, la jornada se calcula sola.`;
    };
    let borrar = null;
    const alPulsar = ev => {
      const b = ev.target.closest('[data-borrar-regimen]');
      if (!b) return;
      borrar = b.dataset.borrarRegimen;   // el envío del formulario (value «borrar») cierra el diálogo sin guardar
    };
    dlg.addEventListener('input', alEditar);
    dlg.addEventListener('click', alPulsar);
    const form = await pendiente;
    dlg.removeEventListener('input', alEditar);
    dlg.removeEventListener('click', alPulsar);

    if (borrar) {
      const p = historial.find(x => x.desde === borrar);
      const ok = await preguntar('Borrar cambio de régimen',
        `<p>¿Borrar el régimen de <strong>${esc(nombre)}</strong> desde el ${fecha(borrar)} (${esc(texto(p))})?</p><p class="tenue">Esos días pasarán a usar el régimen anterior. Los costes e indicadores se recalculan solos.</p>`,
        { aceptar: 'Borrar', peligro: true });
      if (!ok) continue;
      try {
        await api.guardarParametroUnidad({ unidad, desde: borrar, servicios: p.servicios, jornada: p.jornada, borrar: true });
        avisar('Cambio de régimen borrado.');
        return true;
      } catch (e) { error = e; continue; }
    }
    if (!form) return cambiado;

    v = Object.fromEntries(new FormData(form));
    const servicios = Number(v.servicios), jornada = Math.round(Number(v.jornada));
    if (!v.desde) { error = new Error('Falta la fecha desde la que vale el cambio.'); continue; }
    if (!(servicios >= 0 && servicios <= 4)) { error = new Error('Los servicios al día van de 0 a 4.'); continue; }
    if (!(jornada >= 1 && jornada <= 720)) { error = new Error('La jornada va de 1 a 720 minutos.'); continue; }
    const horario = v.horaDesde && v.horaHasta ? `${v.horaDesde}-${v.horaHasta}` : '';
    try {
      await api.guardarParametroUnidad({ unidad, desde: v.desde, servicios, jornada, ...(horario ? { horario } : {}), ...(v.notas.trim() ? { notas: v.notas.trim() } : {}) });
      avisar(`${nombre}: ${texto({ servicios, jornada, horario })} a partir del ${fecha(v.desde)}.`);
      return true;
    } catch (e) { error = e; }
  }
}
