// Pantalla de combustible: asignar cada gasto de vehículo (combustible, renting, mantenimiento) a su matrícula.
import * as api from './api.js?v=23';
import { esc, eur, fecha, mesActual, sumarMeses, nombreMes, avisar, cajaError, selectorMes } from './ui.js?v=23';
import { abrirVisor, valorTipo, etiquetaTipo, tiposConEquipos, textoReparto } from './visor.js?v=23';

const SIN = '';
// Gasto imputado a Estructura sin vehículo concreto (BACKEND.md v3.20.24): cuenta como asignado
const ESTRUCTURA = 'ESTRUCTURA';
const rotulo = m => m === ESTRUCTURA ? 'Estructura (sin vehículo)' : m;

export function montar(el) {
  let mes = mesActual();
  let cfg = null, compras = null, comprasAnt = null;
  let errorCarga = null, errorGuardado = null;
  let guardando = false;
  let pendientes = new Map();   // idFactura → matrícula elegida y aún no guardada
  let arrastre = null;
  let clasificando = new Set();

  async function recargar() {
    errorCarga = null;
    pintar(true);
    try {
      const [c, a, b] = await Promise.all([api.leerConfig(), api.leerCompras(mes), api.leerCompras(sumarMeses(mes, -1))]);
      cfg = c; compras = a; comprasAnt = b;
      // Lo ya guardado en el servidor deja de estar pendiente
      for (const [id, m] of pendientes) {
        const f = compras.facturas.find(x => x.id === id);
        if (!f || (f.matricula || SIN) === m) pendientes.delete(id);
      }
    } catch (e) {
      errorCarga = e;
    }
    pintar();
  }

  // panelAsignarCombustible vale para cualquier gasto de vehículo (BACKEND.md v3.20.21)
  const TIPOS_VEHICULO = ['combustible', 'vehiculo'];
  const deCombustible = r => (r?.facturas || []).filter(f => TIPOS_VEHICULO.includes(f.tipo));
  const matriculaDe = f => pendientes.has(f.id) ? pendientes.get(f.id) : (f.matricula || SIN);
  // Siempre los vehículos activos hoy, sea cual sea el mes de la factura (decisión de la Dirección, 25/09/2026)
  const vehiculosDelMes = () => cfg.vehiculos.filter(v => v.activo !== false);

  function totales(facturas, conPendientes) {
    const t = new Map();
    for (const f of facturas) {
      const m = conPendientes ? matriculaDe(f) : (f.matricula || SIN);
      t.set(m, Math.round(((t.get(m) || 0) + Number(f.importeSinIva || 0)) * 100) / 100);
    }
    return t;
  }

  async function guardar() {
    if (!pendientes.size) return;
    // matricula: null quita el vehículo de la factura
    const asignaciones = [...pendientes].map(([idFactura, matricula]) => ({ idFactura, matricula: matricula || null }));
    if (!asignaciones.length) return;
    guardando = true; errorGuardado = null; pintar();
    try {
      const r = await api.asignarCombustible(asignaciones);
      (r.avisos || []).forEach(a => avisar(String(a), 'aviso', 12000));
      avisar(`${asignaciones.length} factura${asignaciones.length === 1 ? '' : 's'} asignada${asignaciones.length === 1 ? '' : 's'}.`);
      guardando = false;
      await recargar();
      return;
    } catch (e) {
      errorGuardado = e;
    }
    guardando = false;
    pintar();
  }

  async function clasificar(proveedor, tipo) {
    clasificando.add(proveedor); pintar();
    try {
      await api.clasificarProveedor(proveedor, tipo);
      const t = (compras.tiposProveedor || []).find(x => valorTipo(x) === tipo);
      const esLinea = (compras.sinClasificar || []).some(f => f.proveedor === proveedor && f.esLinea);
      avisar(esLinea
        ? `La línea «${proveedor}» queda clasificada como «${t ? etiquetaTipo(t) : tipo}». Las próximas líneas con ese texto entrarán solas.`
        : `«${proveedor}» queda clasificado como «${t ? etiquetaTipo(t) : tipo}». Sus próximas facturas entrarán solas.`);
      clasificando.delete(proveedor);
      await recargar();
      return;
    } catch (e) {
      avisar(e.message, 'error');
    }
    clasificando.delete(proveedor);
    pintar();
  }

  // Vista previa y clasificación de una factura; al guardar se vuelve a leer (refresca los pendientes)
  async function verFactura(id) {
    const resumen = (compras.sinClasificar || []).find(f => f.id === id) || (compras.facturas || []).find(f => f.id === id);
    if (!resumen) return;
    if (await abrirVisor({ resumen, compras })) recargar();
  }

  function filaFactura(f, vehs) {
    const m = matriculaDe(f);
    const sinAsignar = !m;
    const opciones = [...vehs.map(v => v.matricula)];
    if (m && m !== ESTRUCTURA && !opciones.includes(m)) opciones.push(m);
    opciones.push(ESTRUCTURA);
    return `<tr class="${sinAsignar ? 'destacada' : ''}" draggable="true" data-factura="${esc(f.id)}">
      <td>${fecha(f.fecha)}</td>
      <td>${esc(f.proveedor)} <button class="boton secundario mini" data-accion="ver" data-id="${esc(f.id)}" title="Ver la factura y cambiar su clasificación">Ver</button></td>
      <td><span class="insignia">${f.tipo === 'combustible' ? 'combustible' : 'renting o mant.'}</span></td>
      <td>${esc(f.numero || '')}</td>
      <td class="num">${eur(f.importeSinIva)}</td>
      <td>
        <select data-factura="${esc(f.id)}" aria-label="Vehículo de la factura ${esc(f.numero || f.id)}">
          <option value="" ${sinAsignar ? 'selected' : ''}>${f.matricula ? '— Quitar vehículo —' : '— Elige vehículo —'}</option>
          ${opciones.map(x => `<option value="${esc(x)}" ${x === m ? 'selected' : ''}>${esc(rotulo(x))}${veh(x)?.modelo ? ' · ' + esc(veh(x).modelo) : ''}</option>`).join('')}
        </select>
        ${pendientes.has(f.id) ? '<span class="insignia sugerido">sin guardar</span>' : ''}
      </td>
    </tr>`;
  }
  const veh = m => cfg.vehiculos.find(v => v.matricula === m);

  function pintar(cargando = false) {
    const cabecera = `<div class="barra">
        <div><h1>Combustible y vehículos</h1><p class="tenue">Cada gasto de vehículo necesita su matrícula. Los rentings con la matrícula en el texto llegan ya asignados.</p></div>
        <span class="empuje"></span>${selectorMes('mes', mes)}
      </div>`;
    if (cargando && !compras) { el.innerHTML = cabecera + '<p class="cargando">Cargando facturas…</p>'; return; }
    if (errorCarga && !compras) {
      el.innerHTML = cabecera + cajaError(errorCarga, 'No se han podido cargar las facturas') + '<button class="boton" data-accion="recargar">Reintentar</button>';
      return;
    }
    if (!compras) return;

    const facturas = deCombustible(compras).sort((a, b) => (!!matriculaDe(a) - !!matriculaDe(b)) || String(a.fecha).localeCompare(b.fecha));
    const sinAsignar = facturas.filter(f => !matriculaDe(f));
    const asignadas = facturas.filter(f => matriculaDe(f));
    const vehs = vehiculosDelMes();
    const tot = totales(facturas, true);
    const totComb = totales(facturas.filter(f => f.tipo === 'combustible'), true);
    const totAnt = totales(deCombustible(comprasAnt), false);
    const matriculas = [...new Set([...vehs.map(v => v.matricula), ...[...tot.keys()].filter(k => k && k !== ESTRUCTURA)]), ESTRUCTURA];

    const tipos = (compras.tiposProveedor || []).filter(t => valorTipo(t) !== 'sinClasificar');
    // Compras de material y herramienta del mes: cada una con sus equipos y el reparto
    const tiposEq = tiposConEquipos(compras);
    const deEquipos = (compras.facturas || []).filter(f => tiposEq.includes(f.tipo)).sort((a, b) => String(a.fecha).localeCompare(b.fecha));
    const etiqueta = v => { const t = [...(compras.tiposFactura || []), ...(compras.tiposProveedor || [])].find(x => valorTipo(x) === v); return t ? etiquetaTipo(t) : v; };
    const destinoSinEquipos = f => f.tipo === 'herramienta' ? 'Estructura' : f.tipo === 'material' ? 'material de cierres (no suma)' : 'falta elegir equipos';
    // Sin clasificar: agrupadas por proveedor, pero cada factura se clasifica por separado
    const porProveedor = new Map();
    for (const f of compras.sinClasificar || []) {
      const p = porProveedor.get(f.proveedor) || { facturas: [], total: 0, esLinea: !!f.esLinea };
      p.facturas.push(f); p.total += Number(f.importeSinIva || 0);
      porProveedor.set(f.proveedor, p);
    }

    el.innerHTML = cabecera + `
      ${avisoPendientes(compras.pendientes)}
      ${errorCarga ? cajaError(errorCarga, 'No se ha podido actualizar') : ''}
      ${errorGuardado ? cajaError(errorGuardado, 'El servidor no ha aceptado las asignaciones') : ''}

      <section class="bloque">
        <h2>Resumen por vehículo · ${esc(nombreMes(mes))}</h2>
        <p class="tenue">Puedes arrastrar una factura sobre la tarjeta de su vehículo.</p>
        <div class="resumen-vehiculos">
          ${matriculas.map(m => {
            const actual = tot.get(m) || 0, ant = totAnt.get(m) || 0, dif = Math.round((actual - ant) * 100) / 100;
            return `<div class="destino" data-matricula="${esc(m)}">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${m === ESTRUCTURA
                ? '<strong>Estructura</strong> <span class="tenue">sin vehículo</span>'
                : `<span class="placa${veh(m)?.sinMatricula ? ' sin' : ''}"><b>${esc(m)}</b></span> <span class="tenue">${esc(veh(m)?.modelo || '')}</span>`}</div>
              <div class="importe">${eur(actual)}</div>
              ${actual ? `<div class="tenue">Combustible ${eur(totComb.get(m) || 0)} · renting y mant. ${eur(Math.round((actual - (totComb.get(m) || 0)) * 100) / 100)}</div>` : ''}
              <div class="tenue">Mes anterior: ${eur(ant)}
                ${ant || actual ? `<span class="diferencia ${dif > 0 ? 'sube' : dif < 0 ? 'baja' : ''}">(${dif > 0 ? '+' : ''}${eur(dif)})</span>` : ''}</div>
            </div>`;
          }).join('') || '<p class="vacio">No hay vehículos vigentes este mes.</p>'}
          ${tot.get(SIN) ? `<div class="destino" style="border-color:var(--aviso)"><strong>Sin asignar</strong><div class="importe">${eur(tot.get(SIN))}</div><div class="tenue">${sinAsignar.length} factura${sinAsignar.length === 1 ? '' : 's'}</div></div>` : ''}
        </div>
      </section>

      <section class="bloque">
        <div class="barra" style="align-items:center">
          <h2 style="margin:0">Gastos de vehículo</h2>
          <span class="empuje"></span>
          ${pendientes.size ? `<span class="insignia sugerido">${pendientes.size} sin guardar</span>
            <button class="boton secundario" data-accion="descartar" ${guardando ? 'disabled' : ''}>Descartar</button>` : ''}
          <button class="boton" data-accion="guardar" ${pendientes.size && !guardando ? '' : 'disabled'}>${guardando ? 'Guardando…' : 'Guardar asignaciones'}</button>
        </div>
        ${sinAsignar.length ? `<div class="caja-aviso"><strong>${sinAsignar.length} factura${sinAsignar.length === 1 ? '' : 's'} sin vehículo.</strong> Mientras no se asignen, el coste de vehículo de la liquidación no será correcto.</div>` : ''}
        <div class="tabla-scroll"><table>
          <thead><tr><th>Fecha</th><th>Proveedor</th><th>Tipo</th><th>Número</th><th class="num">Importe sin IVA</th><th>Vehículo</th></tr></thead>
          <tbody>${[...sinAsignar, ...asignadas].map(f => filaFactura(f, vehs)).join('') || '<tr><td colspan="6" class="vacio">No hay gastos de vehículo este mes.</td></tr>'}</tbody>
        </table></div>
      </section>

      ${deEquipos.length ? `<section class="bloque">
        <h2>Material y herramienta · ${esc(nombreMes(mes))}</h2>
        <p class="tenue">Compras que pueden cargarse a los equipos, a partes iguales en el mes de la factura. Ábrelas para cambiar el tipo o los equipos.</p>
        <div class="tabla-scroll"><table>
          <thead><tr><th>Fecha</th><th>Proveedor</th><th>Tipo</th><th class="num">Importe sin IVA</th><th>Equipos</th><th></th></tr></thead>
          <tbody>${deEquipos.map(f => `<tr>
            <td>${fecha(f.fecha)}</td><td>${esc(f.proveedor)}${f.numero ? ` <span class="tenue">${esc(f.numero)}</span>` : ''}</td>
            <td><span class="insignia">${esc(etiqueta(f.tipo))}</span>${f.manual ? ' <span class="insignia ok" title="Clasificada a mano: la sincronización nocturna no la cambia">a mano</span>' : ''}</td>
            <td class="num">${eur(f.importeSinIva)}</td>
            <td>${f.equipos?.length
              ? `${f.equipos.map(e => `<span class="insignia">${esc(e)}</span>`).join(' ')} <span class="tenue">${esc(textoReparto(f.importeSinIva, f.equipos))}</span>`
              : `<span class="tenue">${esc(destinoSinEquipos(f))}</span>`}</td>
            <td class="num"><button class="boton secundario mini" data-accion="ver" data-id="${esc(f.id)}">Ver y cambiar</button></td></tr>`).join('')}</tbody>
        </table></div>
      </section>` : ''}

      ${porProveedor.size ? `<section class="bloque">
        <h2>Facturas sin clasificar</h2>
        <p class="tenue">Abre cada factura para verla y clasificarla. Si todas las de un proveedor son del mismo tipo, aplícalo al proveedor entero y sus próximas facturas entrarán solas.</p>
        ${[...porProveedor].map(([p, d]) => `<div class="grupo-proveedor">
          <div class="grupo-cabecera">
            <div><strong>${esc(p)}</strong>${d.esLinea ? ' <span class="insignia" title="Línea de una factura de proveedor mixto: se guarda como regla para ese texto">línea de factura mixta</span>' : ''}
              <span class="tenue">· ${d.facturas.length} factura${d.facturas.length === 1 ? '' : 's'} · ${eur(d.total)}</span></div>
            <span class="empuje"></span>
            <label class="en-linea">Todas como
              <select data-proveedor-tipo="${esc(p)}" aria-label="Tipo para todo el proveedor ${esc(p)}">
                <option value="">— Elige —</option>
                ${tipos.map(t => `<option value="${esc(valorTipo(t))}">${esc(etiquetaTipo(t))}</option>`).join('')}
              </select></label>
            <button class="boton secundario mini" data-accion="clasificar" data-proveedor="${esc(p)}" ${clasificando.has(p) ? 'disabled' : ''}>Aplicar a todo el proveedor</button>
          </div>
          <div class="tabla-scroll"><table>
            <thead><tr><th>Fecha</th><th>Número</th><th class="num">Importe sin IVA</th><th></th></tr></thead>
            <tbody>${d.facturas.map(f => `<tr>
              <td>${fecha(f.fecha)}</td><td>${esc(f.numero || '—')}</td><td class="num">${eur(f.importeSinIva)}</td>
              <td class="num"><button class="boton mini" data-accion="ver" data-id="${esc(f.id)}">Ver y clasificar</button></td></tr>`).join('')}</tbody>
          </table></div>
        </div>`).join('')}
      </section>` : ''}`;
  }

  // Lo que falta en todos los meses desde mayo de 2026 (panelCompras.pendientes). null: no se pinta nada.
  function avisoPendientes(p) {
    if (!p || (!p.sinAsignar && !p.sinClasificar)) return '';
    const partes = [];
    if (p.sinAsignar) partes.push(`Faltan <strong>${p.sinAsignar} factura${p.sinAsignar === 1 ? '' : 's'}</strong> por asignar matrícula o Estructura (${eur(p.importeSinAsignar)})`);
    if (p.sinClasificar) partes.push(`<strong>${p.sinClasificar}</strong> sin clasificar`);
    const chip = (m, texto) => `<button class="boton secundario mini${m === mes ? ' actual' : ''}" data-accion="ir-mes" data-mes="${esc(m)}" ${m === mes ? 'aria-current="true"' : ''}>${esc(nombreMes(m))} · ${texto}</button>`;
    return `<div class="caja-aviso pendientes">
      <p style="margin:0 0 .5rem">${partes.join(' · ')}${p.desde ? ` <span class="tenue">desde ${esc(nombreMes(p.desde))}</span>` : ''}.</p>
      <div class="botones-tipo">
        ${(p.porMes || []).map(x => chip(x.mes, `${x.n} sin asignar (${eur(x.importeSinIva)})`)).join('')}
        ${(p.sinClasificarPorMes || []).map(x => chip(x.mes, `${x.n} sin clasificar`)).join('')}
      </div></div>`;
  }

  function irAMes(nuevo, selector) {
    if (!nuevo || nuevo === mes) return;
    if (pendientes.size && !confirm('Hay asignaciones sin guardar. ¿Cambiar de mes y descartarlas?')) { if (selector) selector.value = mes; return; }
    pendientes.clear(); errorGuardado = null;
    mes = nuevo; compras = null;
    recargar();
  }

  function alCambiar(ev) {
    const t = ev.target;
    if (t.id === 'mes') {
      irAMes(t.value, t);
    } else if (t.dataset.factura) {
      marcar(t.dataset.factura, t.value);
    }
  }
  function marcar(idFactura, matricula) {
    const f = compras.facturas.find(x => x.id === idFactura);
    if (!f) return;
    if ((f.matricula || SIN) === matricula) pendientes.delete(idFactura);
    else pendientes.set(idFactura, matricula);
    errorGuardado = null;
    pintar();
  }
  function alPulsar(ev) {
    const b = ev.target.closest('[data-accion]');
    if (!b) return;
    const a = b.dataset.accion;
    if (a === 'recargar') recargar();
    if (a === 'ir-mes') irAMes(b.dataset.mes);
    if (a === 'guardar') guardar();
    if (a === 'descartar') { pendientes.clear(); errorGuardado = null; pintar(); }
    if (a === 'clasificar') {
      const sel = [...el.querySelectorAll('select[data-proveedor-tipo]')].find(s => s.dataset.proveedorTipo === b.dataset.proveedor);
      if (!sel?.value) { avisar('Elige primero el tipo para todo el proveedor.', 'aviso'); sel?.focus(); return; }
      clasificar(b.dataset.proveedor, sel.value);
    }
    if (a === 'ver') verFactura(b.dataset.id);
  }
  function alArrastrar(ev) {
    const tr = ev.target.closest?.('tr[data-factura]');
    if (!tr) return;
    arrastre = tr.dataset.factura;
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', arrastre);
  }
  function alPasar(ev) {
    const d = arrastre && ev.target.closest('.destino[data-matricula]');
    if (!d) return;
    ev.preventDefault();
    d.classList.add('encima');
  }
  function alSalir(ev) {
    const d = ev.target.closest('.destino');
    if (d && !d.contains(ev.relatedTarget)) d.classList.remove('encima');
  }
  function alSoltar(ev) {
    const d = arrastre && ev.target.closest('.destino[data-matricula]');
    if (!d) return;
    ev.preventDefault();
    const id = arrastre; arrastre = null;
    marcar(id, d.dataset.matricula);
  }
  const alTerminar = () => { arrastre = null; el.querySelectorAll('.encima').forEach(n => n.classList.remove('encima')); };

  const eventos = { change: alCambiar, click: alPulsar, dragstart: alArrastrar, dragover: alPasar, dragleave: alSalir, drop: alSoltar, dragend: alTerminar };
  Object.entries(eventos).forEach(([k, fn]) => el.addEventListener(k, fn));
  recargar();

  return {
    pendiente: () => pendientes.size > 0,
    recargar,
    desmontar: () => Object.entries(eventos).forEach(([k, fn]) => el.removeEventListener(k, fn)),
  };
}
