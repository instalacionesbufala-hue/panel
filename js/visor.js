// Visor de factura: vista previa (PDF o líneas) y clasificación factura a factura (BACKEND.md v3.20.27).
import * as api from './api.js?v=32';
import { esc, eur, fecha, avisar, cajaError, listaAvisos, preguntar } from './ui.js?v=32';

// Los tipos llegan como texto u objeto { valor, etiqueta }
export const valorTipo = t => typeof t === 'string' ? t : (t.valor ?? t.id);
export const etiquetaTipo = t => typeof t === 'string' ? t.charAt(0).toUpperCase() + t.slice(1) : (t.etiqueta ?? t.nombre ?? valorTipo(t));
const MATERIAL_USO = 'materialUso';
// Con «todas» no valen estos tipos: el backend los rechaza
const NO_TODAS = ['mixto', MATERIAL_USO];
// Nombre del proveedor sin el texto de la línea: «AMAZON… · Cargador» → «AMAZON…»
export const baseProveedor = p => String(p || '').split(' · ')[0];
// Tipos que admiten equipos (panelCompras.tiposConEquipos). Obligatorios solo en «materialUso».
const tiposConEquipos = compras => compras.tiposConEquipos?.length ? compras.tiposConEquipos : [MATERIAL_USO];
// Qué pasa si no se marca ningún equipo (BACKEND.md v3.20.28)
const SIN_EQUIPOS = {
  herramienta: 'Sin equipos marcados, la herramienta va a Estructura.',
  material: 'Sin equipos marcados, no suma a ningún equipo: es el material de los cierres (Saltoki).',
};
// «20,00 € a cada uno», para la lista y el visor
export function textoReparto(importe, equipos) {
  if (!equipos?.length) return '';
  const cada = Math.round(Number(importe || 0) / equipos.length * 100) / 100;
  return equipos.length === 1 ? `todo a ${equipos[0]}` : `${eur(cada)} a cada uno`;
}
export { tiposConEquipos };

// tiposFactura manda el backend; si no llegara, los de proveedor sin «mixto»
const tiposDeFactura = compras => (compras.tiposFactura?.length ? compras.tiposFactura
  : (compras.tiposProveedor || []).filter(t => valorTipo(t) !== 'mixto'));

// Un diálogo nuevo en cada apertura: así una respuesta tardía o un cierre no se mezclan con otra factura
function crearDialogo() {
  document.querySelectorAll('dialog.visor').forEach(d => d.close());   // su evento close lo termina
  const d = document.createElement('dialog');
  d.className = 'visor';
  d.setAttribute('aria-labelledby', 'visor-titulo');
  document.body.append(d);
  return d;
}

function pdfComoUrl(pdf) {
  const binario = atob(pdf.base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  // blob: y no data: — los navegadores bloquean a menudo los PDF servidos como data: dentro de un iframe
  return URL.createObjectURL(new Blob([bytes], { type: pdf.tipo || 'application/pdf' }));
}

/**
 * Abre la factura. `resumen` es la fila de panelCompras (factura o sin clasificar); `compras` la
 * respuesta completa, de donde salen tiposFactura y equiposDisponibles. Devuelve true si se guardó.
 */
export function abrirVisor({ resumen, compras }) {
  const dlg = crearDialogo();
  const tipos = tiposDeFactura(compras);
  const equiposDisponibles = compras.equiposDisponibles || [];
  let tipo = resumen.tipo && tipos.some(t => valorTipo(t) === resumen.tipo) ? resumen.tipo : '';
  const conEquipos = tiposConEquipos(compras);
  // Equipos iniciales: los que ya tenga la factura; si no, todos en «materialUso» (obligatorios) y ninguno en los opcionales
  const equiposIniciales = t => resumen.tipo === t && resumen.equipos?.length ? resumen.equipos : (t === MATERIAL_USO ? equiposDisponibles : []);
  let equipos = new Set(equiposIniciales(tipo));
  // «Aplicar a todas las facturas de este proveedor» (Panel_Compras v1.18): marcada por defecto en las líneas desglosadas
  const base = baseProveedor(resumen.proveedor);
  const delProveedorEnMes = [...(compras.sinClasificar || []), ...(compras.facturas || [])].filter(f => baseProveedor(f.proveedor) === base).length;
  let todas = !!resumen.esLinea;
  const todasPermitida = () => !NO_TODAS.includes(tipo);
  let urlPdf = null, guardando = false, error = null, guardado = false;
  // Se termina a mano (botones, guardado) o con Escape (evento close); lo que llegue primero y una sola vez.
  // No se espera solo al evento close: puede retrasarse si la página no se está dibujando.
  let resolver, terminado = false;
  const promesa = new Promise(r => { resolver = r; });
  function terminar() {
    if (terminado) return;
    terminado = true;
    dlg.removeEventListener('change', alCambiar);
    dlg.removeEventListener('click', alPulsar);
    if (urlPdf) URL.revokeObjectURL(urlPdf);
    if (dlg.open) dlg.close();
    dlg.remove();
    resolver(guardado);
  }

  const importe = () => Number(resumen.importeSinIva ?? 0);
  const reparto = () => equipos.size ? Math.round(importe() / equipos.size * 100) / 100 : 0;

  function pintarLado() {
    const lado = dlg.querySelector('.visor-lado');
    lado.innerHTML = `
      <dl class="visor-datos">
        <dt>Proveedor</dt><dd>${esc(resumen.proveedor)}${resumen.esLinea ? ' <span class="insignia">línea de factura mixta</span>' : ''}</dd>
        <dt>Fecha</dt><dd>${fecha(resumen.fecha)}</dd>
        ${resumen.numero ? `<dt>Número</dt><dd>${esc(resumen.numero)}</dd>` : ''}
        <dt>Importe sin IVA</dt><dd class="visor-importe">${eur(resumen.importeSinIva)}</dd>
        ${resumen.manual ? '<dt>Clasificación</dt><dd><span class="insignia ok">hecha a mano</span></dd>' : ''}
      </dl>
      <fieldset class="visor-tipos"><legend>Clasificar esta factura como</legend>
        ${tipos.map(t => `<label class="opcion-tipo"><input type="radio" name="visor-tipo" value="${esc(valorTipo(t))}" ${valorTipo(t) === tipo ? 'checked' : ''}> ${esc(etiquetaTipo(t))}</label>`).join('')
          || '<p class="tenue">El servidor no ha enviado los tipos de factura.</p>'}
      </fieldset>
      <label class="casilla-todas ${todasPermitida() ? '' : 'inactiva'}"><input type="checkbox" name="visor-todas" ${todas && todasPermitida() ? 'checked' : ''} ${todasPermitida() ? '' : 'disabled'}>
        <span>Aplicar a todas las facturas de <strong>${esc(base)}</strong>, anteriores y futuras
        ${todasPermitida() ? '' : '<small>No se puede con «mixto» ni con «material de uso».</small>'}</span></label>
      ${todas && todasPermitida() && conEquipos.includes(tipo) ? '<p class="tenue">Aplicado a todas, no se cargan equipos. Si alguna debe ir a equipos, ábrela después y elígelos.</p>' : ''}
      ${!(todas && todasPermitida()) && conEquipos.includes(tipo) ? `<fieldset class="visor-equipos"><legend>${tipo === MATERIAL_USO ? 'Repartir entre' : 'Cargar a los equipos (opcional)'}</legend>
          ${equiposDisponibles.map(e => `<label class="en-linea"><input type="checkbox" name="visor-equipo" value="${esc(e)}" ${equipos.has(e) ? 'checked' : ''}> ${esc(e)}</label>`).join('')
            || '<p class="tenue">El servidor no ha enviado los equipos.</p>'}
          <p class="${equipos.size || tipo !== MATERIAL_USO ? 'tenue' : 'error'}" id="visor-reparto">${equipos.size
            ? `${eur(reparto())} a cada uno (${equipos.size} equipo${equipos.size === 1 ? '' : 's'}, a partes iguales, en el mes de la factura).`
            : tipo === MATERIAL_USO ? 'Marca al menos un equipo.' : esc(SIN_EQUIPOS[tipo] || 'Sin equipos marcados, no se carga a ningún equipo.')}</p>
        </fieldset>` : ''}
      ${error ? cajaError(error, 'No se ha guardado') : ''}
      <div class="acciones">
        <button type="button" class="boton secundario" data-visor="cerrar">Cerrar</button>
        <button type="button" class="boton" data-visor="guardar" ${!tipo || guardando || (tipo === MATERIAL_USO && !equipos.size) ? 'disabled' : ''}>${guardando ? 'Guardando…' : 'Guardar clasificación'}</button>
      </div>`;
  }

  function pintarVista(detalle, errorDetalle) {
    const vista = dlg.querySelector('.visor-vista');
    if (!dlg.isConnected || !vista) {   // se cerró antes de que llegara el detalle
      return;
    }
    if (errorDetalle) { vista.innerHTML = cajaError(errorDetalle, 'No se ha podido abrir la factura'); return; }
    if (detalle.pdf?.base64) {
      try {
        urlPdf = pdfComoUrl(detalle.pdf);
        vista.innerHTML = String(detalle.pdf.tipo || '').startsWith('image/')
          ? `<img class="visor-doc" src="${urlPdf}" alt="Factura ${esc(resumen.numero || '')}">`
          : `<iframe class="visor-doc" src="${urlPdf}" title="Factura ${esc(resumen.numero || '')}"></iframe>`;
        return;
      } catch { /* PDF ilegible: se enseñan las líneas */ }
    }
    const f = detalle.factura || {};
    vista.innerHTML = `
      <p class="caja-aviso">${esc(detalle.pdfError || 'Esta factura no tiene PDF.')} Se muestran sus líneas.</p>
      <div class="tabla-scroll"><table>
        <thead><tr><th>Concepto</th><th class="num">Unidades</th><th class="num">Precio</th><th class="num">Importe</th></tr></thead>
        <tbody>${(detalle.lineas || []).map(l => `<tr>
          <td><strong>${esc(l.concepto || '')}</strong>${l.descripcion ? `<br><span class="tenue">${esc(l.descripcion)}</span>` : ''}</td>
          <td class="num">${esc(l.unidades ?? '')}</td><td class="num">${eur(l.precio)}</td><td class="num">${eur(l.importe)}</td></tr>`).join('')
          || '<tr><td colspan="4" class="vacio">Sin líneas.</td></tr>'}</tbody>
        <tfoot><tr><td colspan="3">Base imponible</td><td class="num">${eur(f.subtotal)}</td></tr>
          <tr><td colspan="3">Total con IVA</td><td class="num">${eur(f.total)}</td></tr></tfoot>
      </table></div>
      ${f.notas ? `<p class="tenue">${esc(f.notas)}</p>` : ''}`;
  }

  dlg.innerHTML = `
    <header class="visor-cabecera"><h2 id="visor-titulo">${esc(resumen.proveedor)}</h2>
      <button type="button" class="boton secundario mini" data-visor="cerrar" aria-label="Cerrar">Cerrar</button></header>
    <div class="visor-cuerpo">
      <div class="visor-vista"><p class="cargando">Cargando la factura…</p></div>
      <aside class="visor-lado"></aside>
    </div>`;
  pintarLado();
  dlg.showModal();

  api.leerFacturaDetalle(resumen.id)
    .then(d => pintarVista(d), e => pintarVista(null, e));

  async function guardar() {
    guardando = true; error = null; pintarLado();
    try {
      const t = tipos.find(x => valorTipo(x) === tipo);
      const nombreTipo = t ? etiquetaTipo(t) : tipo;
      if (todas && todasPermitida()) {
        const ok = await preguntar('Aplicar a todas las facturas',
          `<p>Se clasificarán como <strong>«${esc(nombreTipo)}»</strong> todas las facturas de <strong>${esc(base)}</strong> (${delProveedorEnMes} en este mes), también las que clasificaste a mano. Las próximas entrarán así.</p>`,
          { aceptar: 'Aplicar a todas' });
        if (!ok) { guardando = false; pintarLado(); return; }
        const r = await api.clasificarProveedor(resumen.proveedor, tipo, true);
        listaAvisos(r.avisos, 15000);
        avisar(`${base}: ${r.filas ?? 'todas las'} factura${r.filas === 1 ? '' : 's'} clasificada${r.filas === 1 ? '' : 's'} como «${nombreTipo}».`);
      } else {
        // En los tipos con equipos se envía siempre la lista (vacía en los opcionales = ningún equipo)
        const r = await api.clasificarFactura(resumen.id, tipo, conEquipos.includes(tipo) ? [...equipos] : null);
        listaAvisos(r.avisos, 15000);
        avisar(`Factura clasificada como «${nombreTipo}».`);
      }
      guardado = true;
      terminar();
      return;
    } catch (e) {
      error = e;
    }
    guardando = false;
    pintarLado();
  }

  function alCambiar(ev) {
      if (ev.target.name === 'visor-todas') { todas = ev.target.checked; error = null; pintarLado(); }
      if (ev.target.name === 'visor-tipo') { tipo = ev.target.value; equipos = new Set(equiposIniciales(tipo)); error = null; pintarLado(); }
      if (ev.target.name === 'visor-equipo') {
        ev.target.checked ? equipos.add(ev.target.value) : equipos.delete(ev.target.value);
        pintarLado();
      }
  }
  function alPulsar(ev) {
    const b = ev.target.closest('[data-visor]');
    if (!b) return;
    if (b.dataset.visor === 'cerrar') terminar();
    if (b.dataset.visor === 'guardar') guardar();
  }
  dlg.addEventListener('change', alCambiar);
  dlg.addEventListener('click', alPulsar);
  dlg.addEventListener('close', terminar, { once: true });
  return promesa;
}
