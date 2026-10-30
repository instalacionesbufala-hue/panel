// Alta completa y edición de equipos (BACKEND.md, «Alta completa de equipos», Panel Config v1.7.0).
// Va por panelGuardarConfig (solo gerencia: lo limita panel-puente). «Comprobar» manda el mismo cuerpo con
// simular: true y enseña el plan sin escribir nada; «Guardar» lo manda de verdad.
import * as api from './api.js?v=35';
import { esc, hoy, vigente, preguntar, cajaError } from './ui.js?v=35';

const ROLES_NO_PRODUCTIVOS = ['SAT', 'Gerencia'];
const PREFIJO = 'Búfala ';

// Lo que hay en la unidad hoy, para orientar al elegir técnicos y furgoneta
function unidadActual(cfg, dia, filtro) {
  const a = cfg.asignaciones.find(x => filtro(x) && vigente(x.desde, x.hasta, dia));
  return a ? (cfg.unidades.find(u => u.id === a.idUnidad)?.nombre || a.idUnidad) : '';
}

function leer(form) {
  const fd = new FormData(form);
  const v = Object.fromEntries(fd);
  v.tecs = fd.getAll('tec');
  v.nave = fd.has('nave');
  return v;
}

const motivoColor = (c, cfg, unidad) => c.reservado ? c.reservado
  : c.usadoPor && c.usadoPor !== unidad ? `Lo usa ${cfg.unidades.find(u => u.id === c.usadoPor)?.nombre || c.usadoPor}` : '';

function campos(cfg, v, { alta, unidad, plan, error }) {
  const eq = cfg.equipos || {};
  const colores = eq.coloresEvento || [];
  const limite = cfg.limites?.tecnicosPorUnidad;
  const d = v.desde || hoy();
  const tecnicos = cfg.tecnicos.filter(t => vigente(t.alta, t.baja, d) && !ROLES_NO_PRODUCTIVOS.includes(t.rol));
  const vehiculos = cfg.vehiculos.filter(x => vigente(x.desde, x.hasta, d) && !/configuraci/i.test(String(x.origen || '')));
  return `
    ${error ? cajaError(error, alta ? 'No se ha dado de alta' : 'No se ha guardado') : ''}
    ${(eq.avisos || []).map(a => `<p class="caja-aviso">${esc(a)}</p>`).join('')}
    ${alta ? `
    <fieldset class="grupo-equipo"><legend>Unidad</legend>
      <div class="fila-campos">
        <label>Nombre<span class="con-prefijo"><span>${esc(PREFIJO.trim())}</span><input type="number" name="numero" min="1" step="1" value="${esc(v.numero)}" required aria-label="Número de la unidad"></span></label>
        <label>Desde<input type="date" name="desde" value="${esc(d)}" required></label>
      </div>
      <p class="tenue">Técnicos y furgoneta entran en la unidad desde esa fecha. Si ya estaban en otra, salen de ella.</p>
      <div class="lista-marcas">${tecnicos.map(t => {
        const donde = unidadActual(cfg, d, a => a.idTec === t.id);
        return `<label class="marca"><input type="checkbox" name="tec" value="${esc(t.id)}" ${v.tecs.includes(t.id) ? 'checked' : ''}>
          <span>${esc(t.nombre)} <span class="tenue">${esc(t.id)}${donde ? ' · ahora en ' + esc(donde) : ' · sin unidad'}</span></span></label>`;
      }).join('') || '<p class="tenue">No hay técnicos de alta en esa fecha.</p>'}</div>
      ${limite ? `<p class="tenue">Máximo ${limite} técnicos por unidad.</p>` : ''}
      <label>Furgoneta<select name="matricula"><option value="">Sin furgoneta por ahora</option>
        ${vehiculos.map(x => {
          const donde = unidadActual(cfg, d, a => !a.idTec && a.matricula === x.matricula);
          return `<option value="${esc(x.matricula)}" ${v.matricula === x.matricula ? 'selected' : ''}>${esc(x.matricula)} · ${esc(x.modelo || 'Vehículo')}${donde ? ' (ahora en ' + esc(donde) + ')' : ''}</option>`;
        }).join('')}</select></label>
    </fieldset>` : ''}
    <fieldset class="grupo-equipo"><legend>Color de los eventos en el calendario</legend>
      <div class="colores-evento">${colores.map(c => {
        const motivo = motivoColor(c, cfg, unidad);
        return `<label class="color-evento${motivo ? ' bloqueado' : ''}" title="${esc(motivo || c.nombre)}">
          <input type="radio" name="color" value="${esc(c.id)}" ${String(v.color) === String(c.id) ? 'checked' : ''} ${motivo ? 'disabled' : ''} required>
          <span class="muestra" style="background:${esc(c.hex)}"></span><span>${esc(c.nombre)}${motivo ? `<small>${esc(motivo)}</small>` : ''}</span></label>`;
      }).join('') || '<p class="tenue">El servidor no ha enviado los colores.</p>'}</div>
    </fieldset>
    <fieldset class="grupo-equipo"><legend>Calendario</legend>
      ${alta ? `<label class="marca"><input type="radio" name="calModo" value="crear" ${v.calModo !== 'existente' ? 'checked' : ''}><span>Crear calendario nuevo</span></label>
      <label class="marca"><input type="radio" name="calModo" value="existente" ${v.calModo === 'existente' ? 'checked' : ''}><span>Usar uno existente</span></label>` : ''}
      <label>${alta ? 'Identificador del calendario existente' : 'Identificador del calendario'}<input name="calId" value="${esc(v.calId)}" placeholder="…@group.calendar.google.com" spellcheck="false" autocomplete="off"></label>
      <p class="tenue">${alta ? 'Solo si usas uno existente: pégalo tal cual (en Google Calendar, Configuración del calendario → «ID del calendario»).' : 'Para cambiarlo, pega el identificador de otro calendario existente. Puede llevar varios separados por coma.'}</p>
    </fieldset>
    <fieldset class="grupo-equipo"><legend>Kilómetros</legend>
      <label>Dirección de salida<input name="salidaKm" value="${esc(v.salidaKm)}" placeholder="Calle …, 28021 Madrid" autocomplete="off"></label>
      <div class="fila-campos">
        <label>Saltoki habitual<select name="saltoki"><option value="">—</option>
          ${(eq.saltoki || []).map(s => `<option ${v.saltoki === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
        <label class="marca"><input type="checkbox" name="nave" ${v.nave ? 'checked' : ''}><span>Pasa por la nave</span></label>
        <label>Desde<input type="date" name="naveDesde" value="${esc(v.naveDesde)}"></label>
      </div>
    </fieldset>
    ${alta ? '<p class="tenue">El régimen (servicios al día y jornada) se fija justo después de guardar, en su ventana de siempre.</p>' : ''}
    ${plan ? `<div class="${plan.error ? 'caja-error' : 'tarjeta bloque'} plan-equipo"><strong>${plan.error ? 'La comprobación da un problema' : 'Lo que se hará al guardar'}</strong>
      ${plan.error ? `<p>${esc(plan.error)}</p>` : ''}
      ${plan.plan?.length ? `<ul>${plan.plan.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}</div>` : ''}
    <div class="acciones-equipo">
      ${alta ? '' : '<button type="submit" value="regimen" formnovalidate class="boton secundario" data-equipo="regimen">Cambiar régimen…</button>'}
      <button type="submit" value="comprobar" formnovalidate class="boton secundario" data-equipo="comprobar">Comprobar</button>
    </div>`;
}

// Cuerpo de panelGuardarConfig, o un texto con lo que falta
function cuerpoAlta(cfg, v) {
  const n = Number(v.numero);
  if (!Number.isInteger(n) || n < 1) return 'El nombre tiene que ser «Búfala» seguido de un número.';
  const nombre = PREFIJO + n;
  if (cfg.unidades.some(u => u.id === nombre || u.nombre === nombre)) return `Ya existe «${nombre}».`;
  if (!v.desde) return 'Falta la fecha desde la que trabaja la unidad.';
  const limite = cfg.limites?.tecnicosPorUnidad;
  if (limite && v.tecs.length > limite) return `Como mucho ${limite} técnicos por unidad.`;
  if (!v.color) return 'Elige el color de los eventos.';
  if (v.calModo === 'existente' && !v.calId.trim()) return 'Pega el identificador del calendario existente, o elige «Crear calendario nuevo».';
  if (v.nave && !v.naveDesde) return 'Indica desde qué fecha pasa por la nave.';
  return {
    unidades: [{
      nombre, color: Number(v.color),
      calendario: v.calModo === 'existente' ? { modo: 'existente', id: v.calId.trim() } : { modo: 'crear' },
      salidaKm: v.salidaKm.trim(), saltoki: v.saltoki, naveDesde: v.nave ? v.naveDesde : '',
    }],
    asignaciones: [
      ...v.tecs.map(idTec => ({ idTec, idUnidad: nombre, desde: v.desde })),
      ...(v.matricula ? [{ idTec: null, idUnidad: nombre, matricula: v.matricula, desde: v.desde }] : []),
    ],
  };
}
// Edición: solo los campos que cambian. El nombre no se cambia.
function cuerpoEdicion(u, v) {
  const e = u.equipo || {};
  if (!v.color) return 'Elige el color de los eventos.';
  if (v.nave && !v.naveDesde) return 'Indica desde qué fecha pasa por la nave.';
  const cambio = { id: u.id };
  if (Number(v.color) !== Number(e.color)) cambio.color = Number(v.color);
  if (v.salidaKm.trim() !== (e.salidaKm || '')) cambio.salidaKm = v.salidaKm.trim();
  if (v.saltoki !== (e.saltoki || '')) cambio.saltoki = v.saltoki;
  const nave = v.nave ? v.naveDesde : '';
  if (nave !== (e.naveDesde || '')) cambio.naveDesde = nave;
  if (v.calId.trim() && v.calId.trim() !== (e.calendarioId || '')) cambio.calendario = { modo: 'existente', id: v.calId.trim() };
  if (Object.keys(cambio).length === 1) return 'No has cambiado nada.';
  return { unidades: [cambio] };
}

// Calendarios, accesos y avisos del guardado
async function ensenarResultado(titulo, r) {
  const lista = (t, xs) => xs?.length ? `<h3>${t}</h3><ul>${xs.join('')}</ul>` : '';
  await preguntar(titulo, `
    ${lista('Calendarios', (r.calendarios || []).map(c => `<li><strong>${esc(c.unidad)}</strong>: ${c.creado ? 'calendario creado' : 'calendario existente'} · <code>${esc(c.calendarioId)}</code></li>`))}
    ${lista('Accesos', (r.accesos || []).map(a => `<li>${esc(a)}</li>`))}
    ${lista('Avisos', (r.avisos || []).map(a => `<li>${esc(typeof a === 'string' ? a : a.mensaje || JSON.stringify(a))}</li>`))}
    ${!r.calendarios?.length && !r.accesos?.length && !r.avisos?.length ? '<p>Guardado sin avisos.</p>' : ''}`,
  { aceptar: 'Entendido', cancelar: 'Cerrar' });
}

/**
 * Alta (unidad = null) o edición de una unidad. Devuelve { guardado, nombre, regimen } :
 * regimen = true si hay que abrir a continuación la ventana de régimen de la unidad.
 */
// Alta pedida desde otra pantalla («Técnicos y vehículos» con un nombre «Búfala N»): Unidades la abre al cargar
let altaPendiente = null;
export const pedirAlta = numero => { altaPendiente = numero; };
export const tomarAltaPendiente = () => { const n = altaPendiente; altaPendiente = null; return n; };

export async function abrir(cfg, { unidad = null, dia = hoy(), numero = null } = {}) {
  const alta = !unidad;
  const u = alta ? null : cfg.unidades.find(x => x.id === unidad);
  const e = u?.equipo || {};
  const sugerido = numero || Number(String(cfg.equipos?.siguienteUnidad || '').replace(/\D/g, '')) || '';
  let v = alta
    ? { numero: sugerido, desde: dia < hoy() ? hoy() : dia, tecs: [], matricula: '', color: '', calModo: 'crear', calId: '', salidaKm: '', saltoki: '', nave: false, naveDesde: '' }
    : { color: e.color ?? '', calId: e.calendarioId || '', salidaKm: e.salidaKm || '', saltoki: e.saltoki || '', nave: !!e.naveDesde, naveDesde: e.naveDesde || '' };
  let plan = null, error = null;
  const titulo = alta ? 'Nueva unidad' : `Editar ${u?.nombre || unidad}`;

  for (;;) {
    const pendiente = preguntar(titulo, campos(cfg, v, { alta, unidad, plan, error }), { aceptar: alta ? 'Guardar' : 'Guardar cambios' });
    const dlg = document.getElementById('dialogo');
    // «Comprobar» y «Cambiar régimen…» envían el formulario con otro valor: se anota cuál y lo escrito
    let otro = null, escrito = null;
    const alPulsar = ev => {
      const b = ev.target.closest('[data-equipo]');
      if (!b) return;
      otro = b.dataset.equipo;
      escrito = leer(dlg.querySelector('form'));
    };
    dlg.addEventListener('click', alPulsar);
    const form = await pendiente;
    dlg.removeEventListener('click', alPulsar);

    if (!form && !otro) return { guardado: false };
    v = otro ? escrito : leer(form);
    if (otro === 'regimen') return { guardado: false, nombre: unidad, regimen: true };
    const cuerpo = alta ? cuerpoAlta(cfg, v) : cuerpoEdicion(u, v);
    error = null;
    if (typeof cuerpo === 'string') { error = new Error(cuerpo); plan = null; continue; }

    if (otro === 'comprobar') {
      try {
        const r = await api.simularConfig(cuerpo);
        plan = { plan: r.plan || [], error: r.error || '' };
      } catch (err) { plan = null; error = err; }
      continue;
    }
    try {
      const r = await api.guardarConfig(cuerpo);
      const nombre = alta ? cuerpo.unidades[0].nombre : unidad;
      await ensenarResultado(alta ? `${nombre} dada de alta` : `${u?.nombre || unidad}: cambios guardados`, r);
      return { guardado: true, nombre, regimen: alta };
    } catch (err) {
      error = err; plan = null;
    }
  }
}
