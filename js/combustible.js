// Pantalla de combustible: asignar cada factura a un vehículo.
import * as api from './api.js?v=7';
import { esc, eur, fecha, mesActual, sumarMeses, nombreMes, vigenteEnMes, avisar, cajaError, selectorMes } from './ui.js?v=7';

const SIN = '';
// Los tipos de proveedor los manda el backend en panelCompras.tiposProveedor (texto u objeto { valor, etiqueta })
const valorTipo = t => typeof t === 'string' ? t : (t.valor ?? t.id);
const etiquetaTipo = t => typeof t === 'string' ? t.charAt(0).toUpperCase() + t.slice(1) : (t.etiqueta ?? t.nombre ?? valorTipo(t));

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

  const deCombustible = r => (r?.facturas || []).filter(f => f.tipo === 'combustible');
  const matriculaDe = f => pendientes.has(f.id) ? pendientes.get(f.id) : (f.matricula || SIN);
  const vehiculosDelMes = () => cfg.vehiculos.filter(v => vigenteEnMes(v.desde, v.hasta, mes));

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
      avisar(`«${proveedor}» queda clasificado como «${t ? etiquetaTipo(t) : tipo}». Sus próximas facturas entrarán solas.`);
      clasificando.delete(proveedor);
      await recargar();
      return;
    } catch (e) {
      avisar(e.message, 'error');
    }
    clasificando.delete(proveedor);
    pintar();
  }

  function filaFactura(f, vehs) {
    const m = matriculaDe(f);
    const sinAsignar = !m;
    const opciones = [...vehs.map(v => v.matricula)];
    if (m && !opciones.includes(m)) opciones.push(m);
    return `<tr class="${sinAsignar ? 'destacada' : ''}" draggable="true" data-factura="${esc(f.id)}">
      <td>${fecha(f.fecha)}</td>
      <td>${esc(f.proveedor)}</td>
      <td>${esc(f.numero || '')}</td>
      <td class="num">${eur(f.importeSinIva)}</td>
      <td>
        <select data-factura="${esc(f.id)}" aria-label="Vehículo de la factura ${esc(f.numero || f.id)}">
          <option value="" ${sinAsignar ? 'selected' : ''}>${f.matricula ? '— Quitar vehículo —' : '— Elige vehículo —'}</option>
          ${opciones.map(x => `<option value="${esc(x)}" ${x === m ? 'selected' : ''}>${esc(x)}${veh(x)?.modelo ? ' · ' + esc(veh(x).modelo) : ''}</option>`).join('')}
        </select>
        ${pendientes.has(f.id) ? '<span class="insignia sugerido">sin guardar</span>' : ''}
      </td>
    </tr>`;
  }
  const veh = m => cfg.vehiculos.find(v => v.matricula === m);

  function pintar(cargando = false) {
    const cabecera = `<div class="barra">
        <div><h1>Combustible</h1><p class="tenue">Los tickets no traen matrícula: cada factura necesita su vehículo.</p></div>
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
    const totAnt = totales(deCombustible(comprasAnt), false);
    const matriculas = [...new Set([...vehs.map(v => v.matricula), ...[...tot.keys()].filter(Boolean)])];

    const tipos = (compras.tiposProveedor || []).filter(t => valorTipo(t) !== 'sinClasificar');
    // Proveedores sin clasificar, agrupados
    const porProveedor = new Map();
    for (const f of compras.sinClasificar || []) {
      const p = porProveedor.get(f.proveedor) || { n: 0, total: 0 };
      p.n++; p.total += Number(f.importeSinIva || 0);
      porProveedor.set(f.proveedor, p);
    }

    el.innerHTML = cabecera + `
      ${errorCarga ? cajaError(errorCarga, 'No se ha podido actualizar') : ''}
      ${errorGuardado ? cajaError(errorGuardado, 'El servidor no ha aceptado las asignaciones') : ''}

      <section class="bloque">
        <h2>Resumen por vehículo · ${esc(nombreMes(mes))}</h2>
        <p class="tenue">Puedes arrastrar una factura sobre la tarjeta de su vehículo.</p>
        <div class="resumen-vehiculos">
          ${matriculas.map(m => {
            const actual = tot.get(m) || 0, ant = totAnt.get(m) || 0, dif = Math.round((actual - ant) * 100) / 100;
            return `<div class="destino" data-matricula="${esc(m)}">
              <strong>${esc(m)}</strong> <span class="tenue">${esc(veh(m)?.modelo || '')}</span>
              <div class="importe">${eur(actual)}</div>
              <div class="tenue">Mes anterior: ${eur(ant)}
                ${ant || actual ? `<span class="diferencia ${dif > 0 ? 'sube' : dif < 0 ? 'baja' : ''}">(${dif > 0 ? '+' : ''}${eur(dif)})</span>` : ''}</div>
            </div>`;
          }).join('') || '<p class="vacio">No hay vehículos vigentes este mes.</p>'}
          ${tot.get(SIN) ? `<div class="destino" style="border-color:var(--aviso)"><strong>Sin asignar</strong><div class="importe">${eur(tot.get(SIN))}</div><div class="tenue">${sinAsignar.length} factura${sinAsignar.length === 1 ? '' : 's'}</div></div>` : ''}
        </div>
      </section>

      <section class="bloque">
        <div class="barra" style="align-items:center">
          <h2 style="margin:0">Facturas de combustible</h2>
          <span class="empuje"></span>
          ${pendientes.size ? `<span class="insignia sugerido">${pendientes.size} sin guardar</span>
            <button class="boton secundario" data-accion="descartar" ${guardando ? 'disabled' : ''}>Descartar</button>` : ''}
          <button class="boton" data-accion="guardar" ${pendientes.size && !guardando ? '' : 'disabled'}>${guardando ? 'Guardando…' : 'Guardar asignaciones'}</button>
        </div>
        ${sinAsignar.length ? `<div class="caja-aviso"><strong>${sinAsignar.length} factura${sinAsignar.length === 1 ? '' : 's'} sin vehículo.</strong> Mientras no se asignen, el coste de vehículo de la liquidación no será correcto.</div>` : ''}
        <div class="tabla-scroll"><table>
          <thead><tr><th>Fecha</th><th>Proveedor</th><th>Número</th><th class="num">Importe sin IVA</th><th>Vehículo</th></tr></thead>
          <tbody>${[...sinAsignar, ...asignadas].map(f => filaFactura(f, vehs)).join('') || '<tr><td colspan="5" class="vacio">No hay facturas de combustible este mes.</td></tr>'}</tbody>
        </table></div>
      </section>

      ${porProveedor.size ? `<section class="bloque">
        <h2>Proveedores sin clasificar</h2>
        <p class="tenue">Clasifícalos una vez y sus próximas facturas entrarán solas en su sitio.</p>
        <div class="tabla-scroll"><table>
          <thead><tr><th>Proveedor</th><th class="num">Facturas</th><th class="num">Importe sin IVA</th><th>Clasificar como</th></tr></thead>
          <tbody>${[...porProveedor].map(([p, d]) => `<tr>
            <td>${esc(p)}</td><td class="num">${d.n}</td><td class="num">${eur(d.total)}</td>
            <td><div class="botones-tipo">${tipos.map(t => `<button class="boton secundario mini" data-accion="clasificar" data-proveedor="${esc(p)}" data-tipo="${esc(valorTipo(t))}" ${clasificando.has(p) ? 'disabled' : ''}>${esc(etiquetaTipo(t))}</button>`).join('') || '<span class="tenue">El servidor no ha enviado los tipos de proveedor.</span>'}</div></td>
          </tr>`).join('')}</tbody>
        </table></div>
      </section>` : ''}`;
  }

  function alCambiar(ev) {
    const t = ev.target;
    if (t.id === 'mes') {
      if (!t.value) return;
      if (pendientes.size && !confirm('Hay asignaciones sin guardar. ¿Cambiar de mes y descartarlas?')) { t.value = mes; return; }
      pendientes.clear(); errorGuardado = null;
      mes = t.value; compras = null;
      recargar();
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
    if (a === 'guardar') guardar();
    if (a === 'descartar') { pendientes.clear(); errorGuardado = null; pintar(); }
    if (a === 'clasificar') clasificar(b.dataset.proveedor, b.dataset.tipo);
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
