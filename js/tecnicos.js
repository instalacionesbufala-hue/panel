// Maestros: técnicos, vehículos y unidades. Nunca se borra nada: se da de baja con fecha.
import * as api from './api.js?v=25';
import { ayuda, AYUDA } from './ayudas.js?v=25';
import { esc, eur, fecha, hoy, vigente, leerImporte, importeEditable, avisar, preguntar, cajaError, listaAvisos } from './ui.js?v=25';

export function montar(el) {
  let cfg = null;
  let errorCarga = null;
  let verBajas = false;
  // Altas y bajas en producción desde Panel_Config v1.5 (26/09/2026). Se envía solo lo que el backend
  // espera de cada cosa; el resto de campos de panelConfig (rol, activo, origen…) no se reenvía.

  async function recargar() {
    errorCarga = null;
    try { cfg = await api.leerConfig(); } catch (e) { errorCarga = e; }
    pintar();
  }
  // Los vehículos del bloque de costes de estructura (T-Cross) no se cambian aquí, sino en Costes
  const vehiculoDeEstructura = v => /configuraci/i.test(String(v.origen || ''));
  const EN_COSTES = 'Este vehículo sale de los costes de estructura: se cambia en Costes, no aquí.';

  // Abre un formulario en el diálogo; si el servidor rechaza, se vuelve a abrir con lo escrito.
  async function formulario(titulo, campos, valores, construir, textoAceptar = 'Guardar') {
    let error = null;
    for (;;) {
      const html = (error ? cajaError(error, 'No se ha guardado') : '') + campos(valores);
      const form = await preguntar(titulo, html, { aceptar: textoAceptar });
      if (!form) return false;
      valores = Object.fromEntries(new FormData(form));
      const cambios = construir(valores);
      if (typeof cambios === 'string') { error = new Error(cambios); continue; }
      try {
        const r = await api.guardarConfig(cambios);
        listaAvisos(r.avisos);
        // ids: [{ nombre, id }] (v1.5); se aceptan también textos sueltos
        const nuevos = [...(r.ids?.tecnicos || []), ...(r.ids?.unidades || [])]
          .map(x => typeof x === 'string' ? x : x.nombre && x.id && x.nombre !== x.id ? `${x.nombre} → ${x.id}` : (x.id || x.nombre));
        avisar(nuevos.length ? `Guardado. Identificador asignado por el servidor: ${nuevos.join(', ')}.` : 'Guardado.');
        await recargar();
        return true;
      } catch (e) {
        error = e;
      }
    }
  }

  const campo = (nombre, etiqueta, valor, extra = '') =>
    `<label>${etiqueta}<input name="${nombre}" value="${esc(valor ?? '')}" ${extra}></label>`;
  const campoFecha = (nombre, etiqueta, valor, extra = 'required') =>
    `<label>${etiqueta}<input type="date" name="${nombre}" value="${esc(valor ?? '')}" ${extra}></label>`;

  // ── Técnicos ──

  function altaTecnico() {
    return formulario('Alta de técnico',
      v => '<p class="tenue">El identificador (E09, E10…) lo asigna el servidor al guardar. Entra con rol «Instalador». El coste mensual se pone después en «Costes de personal».</p>'
        + campo('nombre', 'Nombre y apellidos', v.nombre, 'required') + campo('grupo', 'Grupo profesional', v.grupo) + campoFecha('alta', 'Fecha de alta', v.alta),
      { alta: hoy() },
      v => {
        const nombre = v.nombre.trim();
        if (cfg.tecnicos.some(t => String(t.nombre).trim().toLowerCase() === nombre.toLowerCase())) return `Ya hay un técnico llamado «${nombre}».`;
        return { tecnicos: [{ nombre, grupo: v.grupo.trim(), alta: v.alta, baja: null }] };
      }, 'Dar de alta');
  }
  function editarTecnico(t) {
    return formulario(`Editar ${t.nombre}`,
      v => campo('nombre', 'Nombre y apellidos', v.nombre, 'required') + campo('grupo', 'Grupo profesional', v.grupo) + campoFecha('alta', 'Fecha de alta', v.alta),
      { nombre: t.nombre, grupo: t.grupo, alta: t.alta },
      v => ({ tecnicos: [{ id: t.id, nombre: v.nombre.trim(), grupo: v.grupo.trim(), alta: v.alta }] }));
  }
  function bajaTecnico(t) {
    const asignado = cfg.asignaciones.some(a => a.idTec === t.id && vigente(a.desde, a.hasta, hoy()));
    return formulario(`Dar de baja a ${t.nombre}`,
      v => `<p>Se cierra su vigencia en la fecha indicada (último día trabajado). No se borra nada: su histórico se conserva.</p>
        ${asignado ? '<p class="caja-aviso">Ahora mismo está asignado a una unidad. El servidor decidirá si cierra también esa asignación.</p>' : ''}
        ${campoFecha('baja', 'Fecha de baja', v.baja)}`,
      { baja: hoy() },
      v => (v.baja < t.alta ? 'La fecha de baja no puede ser anterior al alta.' : { tecnicos: [{ id: t.id, baja: v.baja }] }),
      'Dar de baja');
  }

  // ── Vehículos ──
  function altaVehiculo() {
    return formulario('Alta de vehículo',
      v => campo('matricula', 'Matrícula', v.matricula, 'required autocapitalize="characters"') + campo('modelo', 'Modelo', v.modelo) +
        campo('rentingMes', 'Renting al mes, sin IVA (€)', v.rentingMes, 'inputmode="decimal"') + campoFecha('desde', 'En servicio desde', v.desde),
      { desde: hoy() },
      v => {
        const matricula = v.matricula.replace(/[\s-]/g, '').toUpperCase();
        if (cfg.vehiculos.some(x => x.matricula === matricula)) return `Ya existe el vehículo ${matricula}.`;
        const renting = leerImporte(v.rentingMes);
        if (Number.isNaN(renting)) return 'El importe del renting no es un número válido.';
        return { vehiculos: [{ matricula, modelo: v.modelo.trim(), rentingMes: renting, desde: v.desde, hasta: null }] };
      }, 'Dar de alta');
  }
  function editarVehiculo(x) {
    return formulario(`Editar ${x.matricula}`,
      v => campo('modelo', 'Modelo', v.modelo) + campo('rentingMes', 'Renting al mes, sin IVA (€)', v.rentingMes, 'inputmode="decimal"') + campoFecha('desde', 'En servicio desde', v.desde),
      { modelo: x.modelo, rentingMes: importeEditable(x.rentingMes), desde: x.desde },
      v => {
        const renting = leerImporte(v.rentingMes);
        if (Number.isNaN(renting)) return 'El importe del renting no es un número válido.';
        return { vehiculos: [{ matricula: x.matricula, modelo: v.modelo.trim(), rentingMes: renting, desde: v.desde, hasta: x.hasta ?? null }] };
      });
  }
  function bajaVehiculo(x) {
    return formulario(`Dar de baja ${x.matricula}`,
      v => `<p>El vehículo deja de estar en servicio a partir de esta fecha (último día incluido). Su histórico se conserva.</p>${campoFecha('hasta', 'Fecha de baja', v.hasta)}`,
      { hasta: hoy() },
      v => (x.desde && v.hasta < x.desde ? 'La fecha de baja no puede ser anterior a la de alta.' : { vehiculos: [{ matricula: x.matricula, modelo: x.modelo, rentingMes: x.rentingMes, desde: x.desde, hasta: v.hasta }] }),
      'Dar de baja');
  }

  // ── Unidades ──
  function altaUnidad() {
    return formulario('Nueva unidad',
      v => '<p class="tenue">El nombre es también su identificador y no se puede repetir. Si «computa variable» lo decide el servidor.</p>'
        + campo('nombre', 'Nombre', v.nombre, 'required')
        + `<label>Tipo<select name="tipo">${[['productiva', 'Productiva (brigada)'], ['no_productiva', 'No productiva']]
          .map(([valor, texto]) => `<option value="${valor}" ${v.tipo === valor ? 'selected' : ''}>${texto}</option>`).join('')}</select></label>`,
      { nombre: `Búfala ${cfg.unidades.length + 1}`, tipo: 'productiva' },
      v => {
        const nombre = v.nombre.trim();
        const igual = x => String(x || '').trim().toLowerCase() === nombre.toLowerCase();
        if (cfg.unidades.some(u => igual(u.id) || igual(u.nombre))) return `Ya existe una unidad llamada «${nombre}».`;
        return { unidades: [{ nombre, tipo: v.tipo }] };
      }, 'Crear');
  }
  function bajaUnidad(u) {
    const ocupada = cfg.asignaciones.some(a => a.idUnidad === u.id && vigente(a.desde, a.hasta, hoy()));
    return formulario(`Dar de baja ${u.nombre}`,
      v => `<p>La unidad deja de estar activa desde esta fecha. Su histórico se conserva y se puede seguir consultando.</p>
        ${ocupada ? '<p class="caja-aviso">Tiene técnicos o vehículo asignados hoy. El servidor solo la da de baja si no le quedan técnicos después de esa fecha: vacíala antes en «Unidades».</p>' : ''}
        ${campoFecha('hasta', 'Último día activa', v.hasta)}`,
      { hasta: hoy() },
      v => ({ unidades: [{ id: u.id, activa: false, hasta: v.hasta }] }),
      'Dar de baja');
  }

  // ── Pintado ──
  function pintar() {
    if (!cfg) {
      el.innerHTML = `<h1>Técnicos y vehículos</h1>` + (errorCarga ? cajaError(errorCarga, 'No se ha podido cargar la configuración') + '<button class="boton" data-accion="recargar">Reintentar</button>' : '<p class="cargando">Cargando…</p>');
      return;
    }
    const d = hoy();
    const tecs = cfg.tecnicos.filter(t => verBajas || vigente(t.alta, t.baja, d) || t.alta > d);
    const vehs = cfg.vehiculos.filter(v => verBajas || vigente(v.desde, v.hasta, d) || v.desde > d);
    const unis = cfg.unidades.filter(u => verBajas || u.activa !== false);
    const estado = (desde, hasta) => desde && desde > d ? '<span class="insignia aviso">próxima alta</span>'
      : hasta && hasta < d ? `<span class="insignia">baja ${fecha(hasta)}</span>`
      : hasta ? `<span class="insignia aviso">baja el ${fecha(hasta)}</span>` : '<span class="insignia ok">activo</span>';
    // Las unidades no se renombran (el nombre es su identificador); los vehículos de estructura, en Costes
    const botones = (tipo, id, deBaja, bloqueado = '') => bloqueado ? `<span class="tenue" title="${esc(bloqueado)}">Se cambia en Costes</span>` : `<div class="botones-tipo">
      ${tipo === 'uni' ? '' : `<button class="boton secundario mini" data-accion="editar" data-tipo="${tipo}" data-id="${esc(id)}">Editar</button>`}
      ${deBaja ? '' : `<button class="boton peligro mini" data-accion="baja" data-tipo="${tipo}" data-id="${esc(id)}">Dar de baja</button>`}</div>`;

    el.innerHTML = `
      <div class="barra">
        <div><h1>Técnicos y vehículos</h1><p class="tenue">Dar de baja cierra la vigencia con fecha; nunca se elimina nada.</p></div>
        <label class="empuje" style="display:flex;align-items:center;gap:.4rem;min-width:0"><input type="checkbox" id="ver-bajas" ${verBajas ? 'checked' : ''} style="min-height:0"> Mostrar bajas</label>
      </div>
      ${errorCarga ? cajaError(errorCarga, 'No se ha podido actualizar') : ''}

      <section class="bloque">
        <div class="barra" style="align-items:center"><h2 style="margin:0">Técnicos</h2><span class="empuje"></span><button class="boton" data-accion="alta" data-tipo="tec">Alta de técnico</button></div>
        <div class="tabla-scroll"><table>
          <thead><tr><th>Id.</th><th>Nombre</th><th>Rol ${ayuda(AYUDA.rol)}</th><th>Grupo ${ayuda(AYUDA.grupo)}</th><th>Alta</th><th>Estado</th><th></th></tr></thead>
          <tbody>${tecs.map(t => `<tr class="${t.baja && t.baja < d ? 'baja' : ''}">
            <td>${esc(t.id)}</td><td>${esc(t.nombre)}</td><td>${esc(t.rol || '')}</td><td>${esc(t.grupo || '—')}</td><td>${fecha(t.alta)}</td>
            <td>${estado(t.alta, t.baja)}</td><td>${botones('tec', t.id, !!t.baja)}</td></tr>`).join('') || '<tr><td colspan="7" class="vacio">No hay técnicos.</td></tr>'}</tbody>
        </table></div>
      </section>

      <section class="bloque">
        <div class="barra" style="align-items:center"><h2 style="margin:0">Vehículos</h2><span class="empuje"></span><button class="boton" data-accion="alta" data-tipo="veh">Alta de vehículo</button></div>
        <div class="tabla-scroll"><table>
          <thead><tr><th>Matrícula</th><th>Modelo</th><th>Brigada hoy ${ayuda(AYUDA.brigadaHoy)}</th><th class="num">Renting/mes</th><th>Desde</th><th>Estado</th><th></th></tr></thead>
          <tbody>${vehs.map(v => `<tr class="${v.hasta && v.hasta < d ? 'baja' : ''}">
            <td>${esc(v.matricula)}${v.sinMatricula ? ' <span class="insignia aviso" title="El recurso no tiene matrícula legible: se usa su código interno">sin matrícula</span>' : ''}</td><td>${esc(v.modelo || '')}</td><td>${esc(v.brigada || '—')}</td><td class="num">${eur(v.rentingMes)}</td><td>${fecha(v.desde)}</td>
            <td>${estado(v.desde, v.hasta)}</td><td>${botones('veh', v.matricula, !!v.hasta, vehiculoDeEstructura(v) ? EN_COSTES : '')}</td></tr>`).join('') || '<tr><td colspan="7" class="vacio">No hay vehículos.</td></tr>'}</tbody>
        </table></div>
      </section>

      <section class="bloque">
        <div class="barra" style="align-items:center"><h2 style="margin:0">Unidades</h2><span class="empuje"></span><button class="boton" data-accion="alta" data-tipo="uni">Nueva unidad</button></div>
        <div class="tabla-scroll"><table>
          <thead><tr><th>Id.</th><th>Nombre</th><th>Tipo</th><th>Estado</th><th></th></tr></thead>
          <tbody>${unis.map(u => `<tr class="${u.activa === false ? 'baja' : ''}">
            <td>${esc(u.id)}</td><td>${esc(u.nombre)}</td>
            <td>${u.tipo === 'no_productiva' ? 'No productiva' : 'Brigada'}${u.computaVariable === false ? ' <span class="insignia">no computa variable</span>' : ''}</td>
            <td>${u.activa === false ? `<span class="insignia">baja${u.hasta ? ' ' + fecha(u.hasta) : ''}</span>` : '<span class="insignia ok">activa</span>'}</td>
            <td>${botones('uni', u.id, u.activa === false)}</td></tr>`).join('') || '<tr><td colspan="5" class="vacio">No hay unidades.</td></tr>'}</tbody>
        </table></div>
      </section>`;
  }

  function alPulsar(ev) {
    const b = ev.target.closest('[data-accion]');
    if (!b) return;
    const { accion, tipo, id } = b.dataset;
    if (accion === 'recargar') return recargar();
    const buscar = { tec: () => cfg.tecnicos.find(t => t.id === id), veh: () => cfg.vehiculos.find(v => v.matricula === id), uni: () => cfg.unidades.find(u => u.id === id) }[tipo];
    const acciones = {
      alta: { tec: altaTecnico, veh: altaVehiculo, uni: altaUnidad },
      editar: { tec: editarTecnico, veh: editarVehiculo },
      baja: { tec: bajaTecnico, veh: bajaVehiculo, uni: bajaUnidad },
    };
    const hacer = acciones[accion]?.[tipo];
    if (hacer) hacer(accion === 'alta' ? undefined : buscar());
  }
  function alCambiar(ev) {
    if (ev.target.id === 'ver-bajas') { verBajas = ev.target.checked; pintar(); }
  }

  el.addEventListener('click', alPulsar);
  el.addEventListener('change', alCambiar);
  recargar();

  return {
    recargar,
    desmontar() { el.removeEventListener('click', alPulsar); el.removeEventListener('change', alCambiar); },
  };
}
