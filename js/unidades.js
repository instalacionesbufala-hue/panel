// Pantalla de unidades: formar unidades arrastrando técnicos y vehículos.
import * as api from './api.js?v=20';
import { esc, fecha, hoy, vigente, avisar, preguntar, cajaError, listaAvisos } from './ui.js?v=20';

const LIBRE = '__libre__';
// El rol no restringe nada (BACKEND.md): cualquier técnico va a cualquier unidad. Solo se avisa
// cuando la combinación parece rara; decide quien usa el panel.
const ROLES_NO_PRODUCTIVOS = ['SAT', 'Gerencia'];
// Iniciales y color estable por persona, para las fichas
const COLORES_AVATAR = ['#3B5BF0', '#12B3A0', '#F0609A', '#7C6CF6', '#E39A1B', '#1F8FD6', '#D9467A', '#4E9E3A'];
const iniciales = n => String(n || '?').split(/\s+/).filter(x => /\p{L}/u.test(x)).slice(0, 2).map(x => x[0]).join('').toUpperCase() || '?';
const colorDe = id => COLORES_AVATAR[[...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORES_AVATAR.length];
// Unidades no productivas (SAT, Estructura): zona aparte y sin límite de técnicos por unidad
const esNoProductiva = u => u?.tipo === 'no_productiva';

export function montar(el) {
  let cfg = null;
  let dia = hoy();
  let base = null;       // composición del servidor en `dia`: Map idUnidad → { tecs: [], mat }
  let borrador = null;   // copia editable
  let errorCarga = null;
  let errorGuardado = null;
  let guardando = false;
  let arrastre = null;   // { tipo: 'tec'|'veh', id }

  const soloLectura = () => dia < hoy();

  // ── Datos ──
  // conservar: si hay cambios sin guardar, se mantienen aunque se vuelva a leer del servidor
  async function recargar(conservar = true) {
    errorCarga = null;
    try {
      const habiaCambios = conservar && cfg && borrador && !soloLectura() && cambios().length > 0;
      cfg = await api.leerConfig();
      if (habiaCambios) base = composicion();
      else recalcular();
    } catch (e) {
      errorCarga = e;
    }
    pintar();
  }

  function unidadesVisibles() {
    const conAsignacion = new Set(cfg.asignaciones.filter(a => vigente(a.desde, a.hasta, dia)).map(a => a.idUnidad));
    return cfg.unidades.filter(u => soloLectura() ? (u.activa || conAsignacion.has(u.id)) : u.activa !== false);
  }
  const tecnicosVisibles = () => cfg.tecnicos.filter(t => vigente(t.alta, t.baja, dia));
  const vehiculosVisibles = () => cfg.vehiculos.filter(v => vigente(v.desde, v.hasta, dia));

  function composicion() {
    const comp = new Map(unidadesVisibles().map(u => [u.id, { tecs: [], mat: null, choques: [] }]));
    for (const a of cfg.asignaciones) {
      if (!vigente(a.desde, a.hasta, dia) || !comp.has(a.idUnidad)) continue;
      const c = comp.get(a.idUnidad);
      if (a.idTec && !c.tecs.includes(a.idTec)) c.tecs.push(a.idTec);
      if (a.matricula) {
        if (c.mat && c.mat !== a.matricula) c.choques.push(`dos vehículos a la vez (${c.mat} y ${a.matricula})`);
        c.mat = c.mat || a.matricula;
      }
    }
    return comp;
  }

  function recalcular() {
    base = composicion();
    borrador = new Map([...base].map(([k, v]) => [k, { tecs: [...v.tecs], mat: v.mat, choques: v.choques }]));
    errorGuardado = null;
  }

  const unidadDeTec = (comp, id) => { for (const [u, c] of comp) if (c.tecs.includes(id)) return u; return null; };
  const unidadDeVeh = (comp, mat) => { for (const [u, c] of comp) if (c.mat === mat) return u; return null; };
  const unidad = id => cfg.unidades.find(u => u.id === id);
  const nombreUnidad = id => unidad(id)?.nombre || id;
  const tec = id => cfg.tecnicos.find(t => t.id === id);
  const veh = m => cfg.vehiculos.find(v => v.matricula === m);

  function cambios() {
    const filas = [];
    const ids = new Set([...[...base.values()].flatMap(c => c.tecs), ...[...borrador.values()].flatMap(c => c.tecs)]);
    // Formato de panelGuardarConfig (BACKEND.md v3.20.22). Técnico: { idTec, idUnidad | null, desde };
    // idUnidad null = sale de todas. La furgoneta va en su propia fila de unidad, no en la del técnico.
    for (const id of ids) {
      const antes = unidadDeTec(base, id), despues = unidadDeTec(borrador, id);
      if (antes !== despues) filas.push({ idTec: id, idUnidad: despues, desde: dia });
    }
    // Furgoneta: { idTec: null, idUnidad, matricula | null, desde }, siempre que cambie la de la unidad.
    // Si se mueve de una unidad a otra salen las dos filas, así ninguna queda contando en dos sitios.
    for (const [u, c] of borrador) {
      const b = base.get(u) || { tecs: [], mat: null };
      if (b.mat !== c.mat) filas.push({ idTec: null, idUnidad: u, matricula: c.mat, desde: dia });
    }
    return filas;
  }
  const unidadCambiada = u => {
    const a = base.get(u), b = borrador.get(u);
    if (!a) return true;
    return a.mat !== b.mat || a.tecs.length !== b.tecs.length || a.tecs.some(t => !b.tecs.includes(t));
  };

  // ── Validación al soltar ──
  function avisosFuturos(idTec, destino) {
    return cfg.asignaciones
      .filter(a => a.idTec === idTec && a.desde > dia && a.idUnidad && a.idUnidad !== destino)
      .map(a => `Tiene programada una asignación a «${esc(nombreUnidad(a.idUnidad))}» desde el ${fecha(a.desde)}.`);
  }

  function rechazo(destino) {
    const sel = destino === LIBRE ? '.columna[data-libre]' : `.hueco[data-unidad="${CSS.escape(destino)}"]`;
    el.querySelectorAll(sel).forEach(n => { n.classList.add('rechazo'); setTimeout(() => n.classList.remove('rechazo'), 900); });
  }

  async function soltar(tipo, id, destino) {
    if (soloLectura()) return;
    // Si mientras se confirma cambia el día o se recarga el borrador, la confirmación ya no vale
    const miBorrador = borrador;
    const sigueIgual = () => borrador === miBorrador && !soloLectura();
    if (tipo === 'tec') {
      const origen = unidadDeTec(borrador, id);
      if (origen === destino || (!origen && destino === LIBRE)) return;
      const t = tec(id);
      if (destino !== LIBRE) {
        const rolRaro = t?.rol && (ROLES_NO_PRODUCTIVOS.includes(t.rol) !== esNoProductiva(unidad(destino)));
        if (rolRaro) avisar(`Ojo: ${t.nombre} tiene rol ${t.rol} y va a «${nombreUnidad(destino)}». Se permite, pero revísalo.`);
        const limite = cfg.limites?.tecnicosPorUnidad;   // solo si el backend lo define; no aplica a las no productivas
        if (limite && !esNoProductiva(unidad(destino)) && borrador.get(destino).tecs.length >= limite) {
          rechazo(destino);
          avisar(`«${nombreUnidad(destino)}» ya tiene ${limite} técnico${limite === 1 ? '' : 's'}, el máximo que admite el servidor.`, 'error');
          return;
        }
        const extras = avisosFuturos(id, destino);
        if (origen) {
          // Un técnico no puede estar en dos unidades el mismo día: se avisa aquí, al soltar
          rechazo(destino);
          const ok = await preguntar('Técnico ya asignado',
            `<p><strong>${esc(t?.nombre || id)}</strong> ya está en <strong>«${esc(nombreUnidad(origen))}»</strong> el ${fecha(dia)}. Un técnico no puede estar en dos unidades a la vez.</p>
             <p>¿Quieres sacarlo de «${esc(nombreUnidad(origen))}» y pasarlo a «${esc(nombreUnidad(destino))}» desde el ${fecha(dia)}?</p>
             ${extras.map(x => `<p class="caja-aviso">${x}</p>`).join('')}`,
            { aceptar: 'Sí, moverlo', cancelar: 'No, dejarlo donde está' });
          if (!ok || !sigueIgual()) return;
        } else if (extras.length) {
          const ok = await preguntar('Asignación programada', extras.map(x => `<p>${x}</p>`).join('') + '<p>¿Asignarlo igualmente?</p>', { aceptar: 'Asignar' });
          if (!ok || !sigueIgual()) return;
        }
      }
      if (origen) borrador.get(origen).tecs = borrador.get(origen).tecs.filter(x => x !== id);
      if (destino !== LIBRE) borrador.get(destino).tecs.push(id);
    } else {
      const origen = unidadDeVeh(borrador, id);
      if (origen === destino || (!origen && destino === LIBRE)) return;
      if (destino !== LIBRE) {
        if (origen) {
          rechazo(destino);
          const ok = await preguntar('Vehículo ya asignado',
            `<p>El vehículo <strong>${esc(id)}</strong> ya está en <strong>«${esc(nombreUnidad(origen))}»</strong> el ${fecha(dia)}.</p>
             <p>¿Pasarlo a «${esc(nombreUnidad(destino))}»? «${esc(nombreUnidad(origen))}» se quedará sin vehículo.</p>`,
            { aceptar: 'Sí, moverlo', cancelar: 'No' });
          if (!ok || !sigueIgual()) return;
        }
        const anterior = borrador.get(destino).mat;
        if (anterior) avisar(`${anterior} vuelve a «vehículos sin asignar».`, 'info');
        borrador.get(destino).mat = id;
      }
      if (origen) borrador.get(origen).mat = null;
    }
    errorGuardado = null;
    pintar();
  }

  async function guardar() {
    const filas = cambios();
    if (!filas.length) return;
    guardando = true;
    errorGuardado = null;
    pintar();
    try {
      const r = await api.guardarConfig({ asignaciones: filas });
      listaAvisos(r.avisos, 20000);   // BACKEND.md: los avisos se enseñan siempre
      avisar(`Composición guardada con efecto desde el ${fecha(dia)}.`, 'info');
      guardando = false;
      await recargar(false);
      return;
    } catch (e) {
      // El backend es la autoridad: si rechaza, el borrador se queda como estaba
      errorGuardado = e;
    }
    guardando = false;
    pintar();
  }

  // ── Pintado ──
  function fichaTec(id) {
    const t = tec(id) || { id, nombre: id };
    return `<div class="ficha tecnico" ${soloLectura() ? '' : 'draggable="true"'} data-tipo="tec" data-id="${esc(id)}">
      <span class="avatar" style="background:${colorDe(t.id)}" aria-hidden="true">${esc(iniciales(t.nombre))}</span>
      <span class="datos"><span class="nombre">${esc(t.nombre)}</span>
      <span class="detalle">${t.rol ? esc(t.rol) + ' · ' : ''}${esc(t.id)}${t.grupo ? ' · ' + esc(t.grupo) : ''}</span></span>
      ${selectorMover('tec', id, unidadDeTec(borrador, id))}
    </div>`;
  }
  function fichaVeh(mat) {
    const v = veh(mat) || { matricula: mat };
    return `<div class="ficha vehiculo" ${soloLectura() ? '' : 'draggable="true"'} data-tipo="veh" data-id="${esc(mat)}">
      <span class="placa${v.sinMatricula ? ' sin' : ''}"><b>${esc(v.matricula)}</b></span>
      <span class="datos"><span class="nombre">${esc(v.modelo || 'Vehículo')}</span>
      <span class="detalle">${v.brigada ? esc(v.brigada) : '&nbsp;'}</span></span>
      ${v.sinMatricula ? '<span class="insignia aviso" title="El recurso no tiene matrícula legible: se usa su código interno">sin matrícula</span>' : ''}
      ${selectorMover('veh', mat, unidadDeVeh(borrador, mat))}
    </div>`;
  }
  // Camino alternativo al arrastre (pantallas táctiles)
  function selectorMover(tipo, id, actual) {
    if (soloLectura()) return '';
    const opciones = [[LIBRE, 'Sin asignar'], ...[...borrador.keys()].map(u => [u, nombreUnidad(u)])];
    return `<select class="mover" data-tipo="${tipo}" data-id="${esc(id)}" aria-label="Mover ${esc(id)} a">
      ${opciones.map(([v, n]) => `<option value="${esc(v)}" ${v === (actual || LIBRE) ? 'selected' : ''}>${v === (actual || LIBRE) ? '' : '→ '}${esc(n)}</option>`).join('')}
    </select>`;
  }

  function pintar() {
    if (errorCarga && !cfg) {
      el.innerHTML = `<h1>Unidades</h1>${cajaError(errorCarga, 'No se ha podido cargar la configuración')}
        <button class="boton" data-accion="recargar">Reintentar</button>`;
      return;
    }
    if (!cfg) return;
    const lectura = soloLectura();
    const filas = lectura ? [] : cambios();
    const asignadosTec = new Set([...borrador.values()].flatMap(c => c.tecs));
    const asignadosVeh = new Set([...borrador.values()].map(c => c.mat).filter(Boolean));
    const libresTec = tecnicosVisibles().filter(t => !asignadosTec.has(t.id));
    const libresVeh = vehiculosVisibles().filter(v => !asignadosVeh.has(v.matricula));
    // Primer día con composición registrada. Si alguna asignación vale «desde siempre» (desde: null), no hay límite.
    const primerRegistro = cfg.asignaciones.some(a => !a.desde) ? null
      : cfg.asignaciones.reduce((m, a) => (!m || a.desde < m ? a.desde : m), null);
    const tarjeta = ([u, c]) => `
              <article class="unidad ${!lectura && unidadCambiada(u) ? 'cambiada' : ''} ${esNoProductiva(unidad(u)) ? 'no-productiva' : ''}">
                <header><h3>${esc(nombreUnidad(u))}</h3>
                  ${unidad(u)?.computaVariable === false ? '<span class="insignia rosa" title="Esta unidad y sus técnicos quedan fuera del cálculo del variable">no computa variable</span>' : ''}
                  <span class="insignia">${c.tecs.length === 0 ? 'sin técnicos' : c.tecs.length === 1 ? '1 técnico' : c.tecs.length + ' técnicos'}</span></header>
                ${c.choques.length ? `<p class="insignia error">Dato incoherente en el servidor: ${esc(c.choques.join('; '))}</p>` : ''}
                <div class="hueco" data-unidad="${esc(u)}" data-acepta="tec">
                  <span class="hueco-titulo">Técnicos</span>
                  ${c.tecs.map(fichaTec).join('') || `<p class="vacio">${lectura ? 'Nadie asignado.' : 'Suelta aquí un técnico.'}</p>`}
                </div>
                <div class="hueco" data-unidad="${esc(u)}" data-acepta="veh">
                  <span class="hueco-titulo">Vehículo</span>
                  ${c.mat ? fichaVeh(c.mat) : `<p class="vacio">${lectura ? 'Sin vehículo.' : 'Suelta aquí un vehículo.'}</p>`}
                </div>
              </article>`;
    const brigadas = [...borrador].filter(([u]) => !esNoProductiva(unidad(u)));
    const noProductivas = [...borrador].filter(([u]) => esNoProductiva(unidad(u)));
    // Resumen del día (solo recuentos de la composición, ningún importe)
    const totalTec = tecnicosVisibles().length, totalVeh = vehiculosVisibles().length;
    const limite = cfg.limites?.tecnicosPorUnidad;
    const completas = brigadas.filter(([, c]) => limite ? c.tecs.length >= limite : c.tecs.length > 0).length;
    const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
    const r = 40, vuelta = 2 * Math.PI * r;
    const resumen = `<div class="bento" aria-label="Resumen del día">
        <div class="kpi heroe">
          <svg class="anillo" viewBox="0 0 96 96" aria-hidden="true"><defs><linearGradient id="grad-anillo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#12B3A0"/><stop offset="1" stop-color="#F0609A"/></linearGradient></defs>
            <circle class="pista" cx="48" cy="48" r="${r}" fill="none" stroke-width="11"/>
            <circle cx="48" cy="48" r="${r}" fill="none" stroke="url(#grad-anillo)" stroke-width="11" stroke-linecap="round"
              stroke-dasharray="${(vuelta * pct(asignadosTec.size, totalTec) / 100).toFixed(1)} ${vuelta.toFixed(1)}" transform="rotate(-90 48 48)"/></svg>
          <div><small>Plantilla asignada · ${esc(fecha(dia))}</small>
            <div class="cifra">${asignadosTec.size}<span> de ${totalTec}</span></div>
            <p>${libresTec.length ? `${libresTec.length} técnico${libresTec.length === 1 ? '' : 's'} sin unidad.` : 'Toda la plantilla tiene unidad.'}
              ${brigadas.filter(([, c]) => !c.tecs.length).length ? ' Hay brigadas vacías.' : ''}</p></div>
        </div>
        <div class="kpi"><small>Brigadas completas</small><div class="cifra">${completas}<span> / ${brigadas.length}</span></div>
          <div class="medidor"><i style="width:${pct(completas, brigadas.length)}%"></i></div></div>
        <div class="kpi ${filas.length ? 'aviso' : ''}"><small>${lectura ? 'Vehículos en uso' : 'Cambios sin guardar'}</small>
          <div class="cifra">${lectura ? `${asignadosVeh.size}<span> / ${totalVeh}</span>` : filas.length}</div>
          ${lectura ? `<div class="medidor"><i style="width:${pct(asignadosVeh.size, totalVeh)}%"></i></div>` : `<span class="tenue">Vehículos en uso: ${asignadosVeh.size} de ${totalVeh}</span>`}</div>
      </div>`;

    el.innerHTML = `
      <div class="barra">
        <div><h1>Unidades</h1><p class="tenue">Arrastra técnicos y un vehículo a cada unidad, o usa el desplegable de cada ficha.</p></div>
        <label class="empuje">Composición del día<input type="date" id="dia" value="${esc(dia)}"></label>
        <button class="boton secundario" data-accion="hoy" ${dia === hoy() ? 'disabled' : ''}>Hoy</button>
      </div>
      ${errorCarga ? cajaError(errorCarga, 'No se ha podido actualizar') : ''}
      ${lectura
        ? `<div class="caja-aviso"><strong>Consulta del ${fecha(dia)} · solo lectura.</strong> ${primerRegistro && dia < primerRegistro
             ? `El servidor no tiene registrada ninguna composición antes del ${fecha(primerRegistro)}, así que este día sale vacío.`
             : 'Así estaban formadas las unidades ese día.'} Para cambiar la composición vuelve a hoy o a una fecha futura.</div>`
        : `<div class="tarjeta bloque barra" style="align-items:center;margin-bottom:1rem">
             <span>${filas.length
               ? `<strong>${filas.length} cambio${filas.length === 1 ? '' : 's'} sin guardar.</strong> Se aplicarán con efecto desde el <strong>${fecha(dia)}</strong>; la asignación anterior se cierra el día antes y queda en el histórico.`
               : `Sin cambios. Fecha de efecto de lo que cambies: <strong>${fecha(dia)}</strong> (se cambia con el selector de día).`}</span>
             <span class="empuje"></span>
             <button class="boton secundario" data-accion="descartar" ${filas.length && !guardando ? '' : 'disabled'}>Descartar</button>
             <button class="boton" data-accion="guardar" ${filas.length && !guardando ? '' : 'disabled'}>${guardando ? 'Guardando…' : 'Guardar composición'}</button>
           </div>`}
      ${errorGuardado ? cajaError(errorGuardado, 'El servidor no ha aceptado el cambio') : ''}
      ${resumen}
      <div class="tablero ${lectura ? 'solo-lectura' : ''}">
        <section class="columna" data-libre="tec" aria-label="Técnicos sin asignar">
          <h2>Técnicos sin asignar <span class="insignia">${libresTec.length}</span></h2>
          <div class="lista-fichas">${libresTec.map(t => fichaTec(t.id)).join('') || '<p class="vacio">Todos los técnicos están en alguna unidad.</p>'}</div>
        </section>
        <section class="col-unidades" aria-label="Unidades">
          <h2 class="zona-titulo">Brigadas</h2>
          <div class="unidades">
            ${brigadas.map(tarjeta).join('') || '<p class="vacio">No hay brigadas activas. Créalas en «Técnicos y vehículos».</p>'}
          </div>
          ${noProductivas.length ? `
          <h2 class="zona-titulo">No productivas <span class="tenue">· sin límite de técnicos</span></h2>
          <div class="unidades">${noProductivas.map(tarjeta).join('')}</div>` : ''}
        </section>
        <section class="columna" data-libre="veh" aria-label="Vehículos sin asignar">
          <h2>Vehículos sin asignar <span class="insignia">${libresVeh.length}</span></h2>
          <div class="lista-fichas">${libresVeh.map(v => fichaVeh(v.matricula)).join('') || '<p class="vacio">Todos los vehículos están asignados.</p>'}</div>
        </section>
      </div>`;
  }

  // ── Eventos (delegados, se enlazan una vez) ──
  const zonaDe = n => n.closest('.hueco[data-unidad], .columna[data-libre]');
  const aceptaTipo = (zona, tipo) => (zona.dataset.acepta || zona.dataset.libre) === tipo;
  const destinoDe = zona => zona.dataset.unidad || LIBRE;

  function alArrastrar(ev) {
    const f = ev.target.closest?.('.ficha[draggable="true"]');
    if (!f) return;
    arrastre = { tipo: f.dataset.tipo, id: f.dataset.id };
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', f.dataset.id);
    f.classList.add('arrastrando');
  }
  function alPasar(ev) {
    if (!arrastre) return;
    const z = zonaDe(ev.target);
    if (!z || !aceptaTipo(z, arrastre.tipo)) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    z.classList.add('encima');
  }
  function alSalir(ev) {
    const z = zonaDe(ev.target);
    if (z && !z.contains(ev.relatedTarget)) z.classList.remove('encima');
  }
  function alSoltar(ev) {
    if (!arrastre) return;
    const z = zonaDe(ev.target);
    el.querySelectorAll('.encima').forEach(n => n.classList.remove('encima'));
    if (!z || !aceptaTipo(z, arrastre.tipo)) return;
    ev.preventDefault();
    const { tipo, id } = arrastre;
    arrastre = null;
    soltar(tipo, id, destinoDe(z));
  }
  function alTerminar() {
    arrastre = null;
    el.querySelectorAll('.arrastrando, .encima').forEach(n => n.classList.remove('arrastrando', 'encima'));
  }
  async function alCambiar(ev) {
    const t = ev.target;
    if (t.id === 'dia') {
      if (!t.value) return;
      if (cambios().length && !(await preguntar('Cambios sin guardar', '<p>Si cambias de día se descartan los cambios que no has guardado.</p>', { aceptar: 'Descartar y cambiar', peligro: true }))) {
        t.value = dia;
        return;
      }
      dia = t.value;
      recalcular();
      pintar();
    } else if (t.classList.contains('mover')) {
      const valor = t.value;
      await soltar(t.dataset.tipo, t.dataset.id, valor);
      pintar();   // si se canceló, el desplegable vuelve a su sitio
    }
  }
  async function alPulsar(ev) {
    const b = ev.target.closest('[data-accion]');
    if (!b) return;
    const a = b.dataset.accion;
    if (a === 'recargar') recargar();
    if (a === 'guardar') guardar();
    if (a === 'descartar') { recalcular(); pintar(); }
    if (a === 'hoy') { const d = el.querySelector('#dia'); d.value = hoy(); d.dispatchEvent(new Event('change', { bubbles: true })); }
  }

  el.addEventListener('dragstart', alArrastrar);
  el.addEventListener('dragover', alPasar);
  el.addEventListener('dragleave', alSalir);
  el.addEventListener('drop', alSoltar);
  el.addEventListener('dragend', alTerminar);
  el.addEventListener('change', alCambiar);
  el.addEventListener('click', alPulsar);

  recargar();

  return {
    pendiente: () => !!(cfg && borrador && !soloLectura() && cambios().length),
    recargar,
    desmontar() {
      el.removeEventListener('dragstart', alArrastrar);
      el.removeEventListener('dragover', alPasar);
      el.removeEventListener('dragleave', alSalir);
      el.removeEventListener('drop', alSoltar);
      el.removeEventListener('dragend', alTerminar);
      el.removeEventListener('change', alCambiar);
      el.removeEventListener('click', alPulsar);
    },
  };
}
