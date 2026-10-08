// Pantalla de costes de personal: volcar el coste de empresa que entrega la gestoría.
import * as api from './api.js?v=32';
import { ayuda, AYUDA } from './ayudas.js?v=32';
import { esc, eur, mesActual, sumarMeses, nombreMes, vigenteEnMes, leerImporte, importeEditable, avisar, cajaError, selectorMes } from './ui.js?v=32';
import { leerResumenGestoria, emparejar } from './nominas.js?v=32';

// SheetJS (Apache 2.0) va copiado en el repositorio y solo se carga al importar un Excel
const RUTA_SHEETJS = 'js/vendor/xlsx-0.20.3.full.min.js';
let cargaSheetJS = null;
function sheetJS() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!cargaSheetJS) {
    cargaSheetJS = new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = RUTA_SHEETJS;
      s.onload = () => (window.XLSX ? ok(window.XLSX) : mal(new Error('No se ha podido cargar el lector de Excel.')));
      s.onerror = () => { cargaSheetJS = null; s.remove(); mal(new Error('No se ha podido cargar el lector de Excel. Comprueba la conexión y vuelve a intentarlo.')); };
      document.head.append(s);
    });
  }
  return cargaSheetJS;
}

// origen: 'gestoria' (nómina), 'manual' (corregido a mano) o 'estimacion' (coste de referencia, solo lectura)
const ORIGENES_REALES = ['gestoria', 'manual'];
const esReal = c => ORIGENES_REALES.includes(c?.origen);
const MESES_HISTORICO = 6;

export function montar(el) {
  // El cierre de la gestoría llega el día 5 del mes siguiente: por defecto, el mes pasado
  let mes = sumarMeses(mesActual(), -1);
  let cfg = null, rango = null;   // rango: respuesta de panelCostes de los últimos meses
  let errorCarga = null, errorGuardado = null;
  let guardando = false;
  let filas = new Map();      // idTec → { texto, estado: 'guardado'|'sugerido'|'editado'|'vacio', sugerencia }
  let informeCsv = null;
  let origen = 'gestoria';    // con qué origen se guarda lo tecleado

  const cambiadas = () => [...filas].filter(([, f]) => f.estado === 'editado');
  const mesesHistorico = () => Array.from({ length: MESES_HISTORICO }, (_, i) => sumarMeses(mes, -i)).reverse();

  async function recargar() {
    errorCarga = null;
    pintar(true);
    try {
      // Una sola lectura cubre el mes, el anterior (sugerencias) y el histórico
      [cfg, rango] = await Promise.all([api.leerConfig(), api.leerCostes(mesesHistorico()[0], mes)]);
      prepararFilas();
    } catch (e) {
      errorCarga = e;
    }
    pintar();
  }

  const costeDe = (m, idTec) => (rango?.costes || []).find(c => c.mes === m && c.idTec === idTec) || null;

  function prepararFilas() {
    const previas = filas;
    filas = new Map();
    for (const t of tecnicosDelMes()) {
      const escrita = previas.get(t.id);
      if (escrita && escrita.estado === 'editado') { filas.set(t.id, escrita); continue; }   // no se pierde lo tecleado
      const actual = costeDe(mes, t.id);
      const anterior = costeDe(sumarMeses(mes, -1), t.id);
      // Sugerencia: el mes anterior si es real; si no, la estimación que manda el backend
      const [sugerencia, fuente] = esReal(anterior) ? [anterior.costeEmpresaMes, 'mes anterior']
        : actual?.origen === 'estimacion' ? [actual.costeEmpresaMes, 'coste de referencia']
        : anterior ? [anterior.costeEmpresaMes, 'mes anterior'] : [null, ''];
      if (esReal(actual)) filas.set(t.id, { texto: importeEditable(actual.costeEmpresaMes), estado: 'guardado', origen: actual.origen, sugerencia });
      else if (sugerencia !== null) filas.set(t.id, { texto: importeEditable(sugerencia), estado: 'sugerido', fuente, sugerencia });
      else filas.set(t.id, { texto: '', estado: 'vacio', sugerencia });
    }
  }
  const tecnicosDelMes = (m = mes) => cfg.tecnicos.filter(t => vigenteEnMes(t.alta, t.baja, m));

  // Qué meses ya tienen coste real de todos los técnicos y cuáles van (en todo o en parte) con estimación
  function pintarHistorico() {
    const caja = el.querySelector('#historico');
    if (!caja || !rango) return;
    caja.innerHTML = mesesHistorico().map(m => {
      const tecs = tecnicosDelMes(m);
      const reales = tecs.filter(t => esReal(costeDe(m, t.id))).length;
      const [clase, texto] = !tecs.length ? ['', 'sin técnicos']
        : reales === tecs.length ? ['ok', 'coste real']
        : reales ? ['aviso', `estimación (${reales} de ${tecs.length} reales)`]
        : ['aviso', 'estimación'];
      return `<span class="insignia ${clase}">${esc(nombreMes(m))}: ${texto}</span>`;
    }).join('');
  }

  async function guardar() {
    const costes = [];
    const errores = [];
    for (const [idTec, f] of cambiadas()) {
      const n = leerImporte(f.texto);
      if (n === null) continue;
      if (Number.isNaN(n) || n < 0) errores.push(idTec);
      else costes.push({ idTec, costeEmpresaMes: n });
    }
    if (errores.length) { avisar(`Revisa el importe de ${errores.join(', ')}: no es un número válido.`, 'error'); return; }
    if (!costes.length) return;
    guardando = true; errorGuardado = null; pintar();
    try {
      const r = await api.guardarCostes(mes, costes, origen);
      (r.avisos || []).forEach(a => avisar(String(a), 'aviso', 12000));
      avisar(`Costes de ${nombreMes(mes)} guardados (${costes.length} técnico${costes.length === 1 ? '' : 's'}).`);
      for (const [id] of cambiadas()) filas.get(id).estado = 'guardado';
      guardando = false;
      await recargar();
      return;
    } catch (e) {
      errorGuardado = e;
    }
    guardando = false;
    pintar();
  }

  // CSV opcional: una línea por técnico con su identificador (o nombre) y el coste
  function importarCsv(texto) {
    const lineas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const sep = [';', '\t', ','].find(s => lineas[0]?.includes(s)) || ';';
    const norm = s => String(s).normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
    const tecs = tecnicosDelMes();
    const leidas = [], sinCasar = [];
    for (const l of lineas) {
      const cols = l.split(sep).map(c => c.replace(/^"|"$/g, '').trim());
      const importe = [...cols].reverse().map(leerImporte).find(n => n !== null && !Number.isNaN(n));
      if (importe === undefined) continue;   // cabecera u otra línea sin importe
      const t = tecs.find(x => cols.some(c => norm(c) === norm(x.id) || norm(c) === norm(x.nombre)));
      if (!t) { sinCasar.push(l); continue; }
      filas.set(t.id, { ...filas.get(t.id), texto: importeEditable(importe), estado: 'editado' });
      leidas.push(t.id);
    }
    informeCsv = { leidas: leidas.length, sinCasar };
    pintar();
  }

  // Excel de la gestoría (encargo 12): hoja «Detalle», coste de empresa = fila «TOTAL», columnas del mismo empleado sumadas
  async function importarExcel(fichero) {
    const XLSX = await sheetJS();
    const libro = XLSX.read(await fichero.arrayBuffer(), { type: 'array' });
    const hoja = libro.SheetNames.find(n => n.trim().toLowerCase() === 'detalle');
    if (!hoja) throw new Error('El fichero no tiene la hoja «Detalle». ¿Es el «Resumen de nómina contable y de costes» de la gestoría?');
    const r = leerResumenGestoria(XLSX.utils.sheet_to_json(libro.Sheets[hoja], { header: 1, raw: true, defval: null }));
    const { casados, sinCasar } = emparejar(r.empleados, tecnicosDelMes());
    for (const { tecnico, empleado } of casados) {
      filas.set(tecnico.id, { ...filas.get(tecnico.id), texto: importeEditable(empleado.importe), estado: 'editado' });
    }
    informeCsv = {
      gestoria: true, fichero: fichero.name, periodo: r.periodo, total: r.total, sumaColumnas: r.sumaColumnas, cuadra: r.cuadra,
      leidas: casados.length, importe: casados.reduce((s, c) => s + c.empleado.importe, 0),
      sinCasar: sinCasar.map(s => ({ ...s, asignado: '' })),
    };
    pintar();
  }
  async function importarFichero(fichero) {
    try {
      if (/\.xlsx?$/i.test(fichero.name)) await importarExcel(fichero);
      else importarCsv(await fichero.text());
    } catch (e) {
      avisar(`No se ha podido leer «${fichero.name}»: ${e.message || e}`, 'error', 15000);
    }
  }
  // Empleado de la gestoría sin casar → técnico elegido a mano
  function asignarSinCasar(i, idTec) {
    const s = informeCsv?.sinCasar?.[i];
    if (!s) return;
    if (s.asignado && s.asignado !== idTec) filas.set(s.asignado, { ...filas.get(s.asignado), texto: '', estado: 'editado' });
    s.asignado = idTec;
    if (idTec) filas.set(idTec, { ...filas.get(idTec), texto: importeEditable(s.empleado.importe), estado: 'editado' });
    pintar();
  }
  function informeGestoria(inf) {
    const otroMes = inf.periodo && inf.periodo !== mes;
    const tecs = tecnicosDelMes();
    return `<div class="${inf.cuadra && !otroMes && !inf.sinCasar.length ? 'tarjeta bloque' : 'caja-aviso'} informe-gestoria">
        <strong>${esc(inf.fichero)}:</strong> ${inf.leidas} empleado${inf.leidas === 1 ? '' : 's'} rellenado${inf.leidas === 1 ? '' : 's'} · ${esc(eur(inf.importe))}
        ${inf.cuadra ? '<span class="insignia ok">cuadra con la gestoría</span>' : ''}. Revisa y pulsa «Guardar costes».
        ${inf.cuadra ? '' : `<p class="caja-error">La suma de las columnas (${esc(eur(inf.sumaColumnas))}) no cuadra con el «Total» de la gestoría (${esc(eur(inf.total))}). Revisa el fichero antes de guardar.</p>`}
        ${otroMes ? `<p class="caja-error">El fichero es de <strong>${esc(nombreMes(inf.periodo))}</strong> y estás en <strong>${esc(nombreMes(mes))}</strong>. Cambia el mes antes de guardar.</p>` : ''}
        ${inf.sinCasar.length ? `<p>Sin casar (${esc(eur(inf.sinCasar.reduce((s, x) => s + x.empleado.importe, 0)))}): elige a quién corresponde cada uno.</p>
          <ul class="sin-casar">${inf.sinCasar.map((s, i) => `<li><span><strong>${esc(s.empleado.nombre)}</strong> · ${esc(eur(s.empleado.importe))}${s.empleado.columnas > 1 ? ` <span class="tenue">(${s.empleado.columnas} contratos sumados)</span>` : ''}${s.candidatos.length > 1 ? ' <span class="tenue">· casa con varios técnicos</span>' : ''}</span>
            <select data-sin-casar="${i}" aria-label="Técnico de ${esc(s.empleado.nombre)}"><option value="">— Sin asignar —</option>
              ${[...s.candidatos, ...tecs.filter(t => !s.candidatos.includes(t))].map(t => `<option value="${esc(t.id)}" ${s.asignado === t.id ? 'selected' : ''}>${esc(t.nombre)} (${esc(t.id)})</option>`).join('')}
            </select></li>`).join('')}</ul>` : ''}
      </div>`;
  }

  function pintar(cargando = false) {
    const cabecera = `<div class="barra">
        <div><h1>Costes de personal</h1><p class="tenue">Coste de empresa del mes por técnico: bruto + Seguridad Social + prorrata de pagas. Se rellena con el cierre de la gestoría.</p></div>
        <span class="empuje"></span>${selectorMes('mes', mes)}
      </div>`;
    if (cargando && !rango) { el.innerHTML = cabecera + '<p class="cargando">Cargando…</p>'; return; }
    if (errorCarga && !rango) {
      el.innerHTML = cabecera + cajaError(errorCarga, 'No se han podido cargar los costes') + '<button class="boton" data-accion="recargar">Reintentar</button>';
      return;
    }
    if (!rango) return;
    const hayCambios = cambiadas().length > 0;
    const sugeridas = [...filas.values()].filter(f => f.estado === 'sugerido').length;

    el.innerHTML = cabecera + `
      <div class="meses" id="historico" aria-label="Estado de los meses"></div>
      ${errorCarga ? cajaError(errorCarga, 'No se ha podido actualizar') : ''}
      ${errorGuardado ? cajaError(errorGuardado, 'El servidor no ha aceptado los costes') : ''}
      ${informeCsv?.gestoria ? informeGestoria(informeCsv) : informeCsv ? `<div class="${informeCsv.sinCasar.length ? 'caja-aviso' : 'tarjeta bloque'}">
          CSV: ${informeCsv.leidas} técnico${informeCsv.leidas === 1 ? '' : 's'} rellenado${informeCsv.leidas === 1 ? '' : 's'}. Revisa y pulsa «Guardar costes».
          ${informeCsv.sinCasar.length ? `<br>Líneas que no corresponden a ningún técnico activo del mes:<ul>${informeCsv.sinCasar.map(l => `<li><code>${esc(l)}</code></li>`).join('')}</ul>` : ''}
        </div>` : ''}
      <div class="barra" style="align-items:center">
        <label class="boton secundario" style="display:inline-flex;align-items:center;color:var(--texto)" title="El Excel de la gestoría (.xls o .xlsx) tal cual llega, o un CSV">Importar fichero
          <input type="file" id="csv" accept=".csv,.txt,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label>
        ${sugeridas ? `<button class="boton secundario" data-accion="aceptar-todas">Dar por buenas las ${sugeridas} sugerencias</button>` : ''}
        <span class="empuje"></span>
        <label class="en-linea">Guardar como
          <select id="origen">
            <option value="gestoria" ${origen === 'gestoria' ? 'selected' : ''}>Dato de la nómina</option>
            <option value="manual" ${origen === 'manual' ? 'selected' : ''}>Corrección manual</option>
          </select></label>
        ${hayCambios ? `<button class="boton secundario" data-accion="descartar" ${guardando ? 'disabled' : ''}>Descartar</button>` : ''}
        <button class="boton" data-accion="guardar" ${hayCambios && !guardando ? '' : 'disabled'}>${guardando ? 'Guardando…' : 'Guardar costes'}</button>
      </div>
      <div class="tabla-scroll"><table>
        <thead><tr><th>Técnico</th><th>Grupo</th><th class="num">Coste de empresa del mes ${ayuda(AYUDA.costeEmpresa)}</th><th>Estado</th></tr></thead>
        <tbody>${tecnicosDelMes().map(t => {
          const f = filas.get(t.id);
          const estado = {
            guardado: `<span class="insignia ok">${f.origen === 'manual' ? 'corregido a mano' : 'coste de nómina'}</span>`,
            sugerido: `<span class="insignia sugerido">sugerencia: ${esc(f.fuente)}</span> <button class="boton secundario mini" data-accion="confirmar" data-id="${esc(t.id)}">Confirmar</button>`,
            editado: '<span class="insignia aviso">sin guardar</span>',
            vacio: '<span class="insignia">pendiente</span>',
          }[f.estado];
          return `<tr class="${f.estado === 'sugerido' ? 'fila-sugerida' : f.estado === 'editado' ? 'fila-cambiada' : ''}">
            <td><strong>${esc(t.nombre)}</strong> <span class="tenue">${esc(t.id)}</span></td>
            <td>${esc(t.grupo || '')}</td>
            <td class="num"><input class="importe" inputmode="decimal" data-id="${esc(t.id)}" value="${esc(f.texto)}" placeholder="0,00" aria-label="Coste de ${esc(t.nombre)}"> €</td>
            <td>${estado}</td>
          </tr>`;
        }).join('') || '<tr><td colspan="4" class="vacio">No hay técnicos activos este mes.</td></tr>'}</tbody>
      </table></div>
      <p class="tenue">Las sugerencias (en morado y con borde discontinuo) no se envían hasta que se confirman o se editan.</p>`;
    pintarHistorico();
  }

  function alEscribir(ev) {
    const t = ev.target;
    if (!t.matches('input.importe')) return;
    const f = filas.get(t.dataset.id);
    f.texto = t.value;
    if (f.estado !== 'editado') {
      f.estado = 'editado';
      const tr = t.closest('tr');
      tr.className = 'fila-cambiada';
      tr.children[3].innerHTML = '<span class="insignia aviso">sin guardar</span>';
      const g = el.querySelector('[data-accion="guardar"]');
      if (g) g.disabled = guardando;
    }
  }
  async function alCambiar(ev) {
    const t = ev.target;
    if (t.id === 'mes') {
      if (!t.value) return;
      if (cambiadas().length && !confirm('Hay costes sin guardar. ¿Cambiar de mes y descartarlos?')) { t.value = mes; return; }
      mes = t.value; filas = new Map(); rango = null; informeCsv = null; errorGuardado = null;
      recargar();
    } else if (t.id === 'origen') {
      origen = t.value;
    } else if (t.id === 'csv' && t.files[0]) {
      const fichero = t.files[0];
      t.value = '';   // así se puede volver a elegir el mismo fichero
      await importarFichero(fichero);
    } else if (t.dataset.sinCasar !== undefined) {
      asignarSinCasar(Number(t.dataset.sinCasar), t.value);
    }
  }
  function alPulsar(ev) {
    const b = ev.target.closest('[data-accion]');
    if (!b) return;
    const a = b.dataset.accion;
    if (a === 'recargar') recargar();
    if (a === 'guardar') guardar();
    if (a === 'confirmar') { filas.get(b.dataset.id).estado = 'editado'; pintar(); }
    if (a === 'aceptar-todas') { filas.forEach(f => { if (f.estado === 'sugerido') f.estado = 'editado'; }); pintar(); }
    if (a === 'descartar') { filas = new Map(); informeCsv = null; errorGuardado = null; prepararFilas(); pintar(); }
  }

  const eventos = { input: alEscribir, change: alCambiar, click: alPulsar };
  Object.entries(eventos).forEach(([k, fn]) => el.addEventListener(k, fn));
  recargar();

  return {
    pendiente: () => cambiadas().length > 0,
    recargar,
    desmontar: () => Object.entries(eventos).forEach(([k, fn]) => el.removeEventListener(k, fn)),
  };
}
