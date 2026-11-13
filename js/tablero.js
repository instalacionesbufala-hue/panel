// Pestaña «Dirección» del dashboard: cuadrícula de bloques configurable por cada usuario
// (BACKEND.md, «Dashboard en el panel», Supabase.gs v1.2.1). Solo diseño: aquí no se edita ningún dato.
// Datos: direccion:indice (catálogo y meses) y direccion:<AAAA-MM> de `vistas`. Diseño: tabla dashboard_disenos.
import * as api from './api.js?v=44';
import { esc, eur, nombreMes, avisar, preguntar, cajaError } from './ui.js?v=44';

const mesTexto = m => (/^\d{4}-\d{2}$/.test(m || '') ? nombreMes(m) : '—');

// Mes que se está viendo (spec 005): es una vista, no diseño. Se recuerda solo en la sesión del navegador.
const CLAVE_MES = 'bufala-panel-dashboard-mes';
const mesRecordado = () => { try { return sessionStorage.getItem(CLAVE_MES) || ''; } catch { return ''; } };
const recordarMes = m => { try { sessionStorage.setItem(CLAVE_MES, m); } catch { /* sin almacenamiento: vale para esta carga */ } };
export function mesEnCurso(hoy = new Date()) { return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`; }
// El último mes cerrado (el anterior al actual), nunca el mes en curso si hay otro publicado
export function mesPorDefecto(lista, actual = mesEnCurso()) {
  const cerrados = lista.filter(m => m < actual).sort();
  return cerrados.at(-1) || [...lista].sort().at(-1) || '';
}
// «octubre de 2026» o «may–oct 2026» («nov 2025–feb 2026» si cruza de año)
const fmtMesCorto = new Intl.DateTimeFormat('es-ES', { month: 'short' });
const mesCorto = m => fmtMesCorto.format(new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1, 1)).replace('.', '');
export function textoPeriodo(lista) {
  if (!lista.length) return '—';
  if (lista.length === 1) return mesTexto(lista[0]);
  const a = lista[0], b = lista.at(-1);
  return `${mesCorto(a)}${a.slice(0, 4) === b.slice(0, 4) ? '' : ' ' + a.slice(0, 4)}–${mesCorto(b)} ${b.slice(0, 4)}`;
}

const COLUMNAS = 12;
const TIPOS = { cifra: 'Cifra', barras: 'Barras', linea: 'Línea', quesito: 'Quesito', tabla: 'Tabla' };
const PALETA = ['#3B5BF0', '#12B3A0', '#F0609A', '#7C6CF6', '#E39A1B', '#1F8FD6', '#D9467A', '#4E9E3A'];
const CHART_JS = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';

let cargaChart = null;
function chartJs() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (!cargaChart) {
    cargaChart = new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = CHART_JS;
      s.onload = () => ok(window.Chart);
      s.onerror = () => { cargaChart = null; s.remove(); mal(new Error('No se han podido cargar las gráficas.')); };
      document.head.append(s);
    });
  }
  return cargaChart;
}

// Valor con su unidad; null/indefinido es «—», nunca 0
export function formato(v, unidad) {
  if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  const u = String(unidad || '').trim();
  if (u === '€') return eur(n);
  if (u === '%') return n.toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' %';
  return n.toLocaleString('es-ES', { maximumFractionDigits: 2 }) + (u ? ' ' + u : '');
}

let siguienteId = 1;
const nuevoId = () => 'b' + Date.now().toString(36) + (siguienteId++);

// Diseño inicial (BACKEND.md): se busca cada indicador en el catálogo por su id o su título
function disenoInicial(catalogo) {
  const buscar = (re, excluir) => catalogo.find(c => !c.pendiente && re.test(`${c.id} ${c.titulo}`) && !(excluir && excluir.test(c.id)))
    || catalogo.find(c => re.test(`${c.id} ${c.titulo}`) && !(excluir && excluir.test(c.id)));
  const piezas = [
    [buscar(/factur/i, /tecnico/i), 'barras', { modo: 'ultimos', n: 6 }, 'equipo', 6, 3],
    [buscar(/resultado/i), 'cifra', { modo: 'mes' }, 'total', 3, 2],
    [buscar(/rentabilidad/i, /tecnico/i), 'barras', { modo: 'mes' }, 'equipo', 3, 3],
    [buscar(/contribuci/i), 'linea', { modo: 'ultimos', n: 6 }, 'total', 6, 3],
    [buscar(/fallid/i), 'linea', { modo: 'ultimos', n: 6 }, 'total', 6, 3],
    [catalogo.find(c => c.id === 'var.porTecnico') || buscar(/variable.*t[eé]cnico|t[eé]cnico.*variable/i), 'tabla', { modo: 'mes' }, 'total', 12, 4],
  ];
  const bloques = piezas.filter(([c]) => c).map(([c, tipo, periodo, vista, w, h]) => ({
    id: nuevoId(), indicador: c.id, tipo, periodo, vista: vista === 'equipo' && !c.porEquipo ? 'total' : vista, w, h,
  }));
  return colocar({ version: 1, bloques });
}
// x, y a partir del orden: se rellenan filas de 12 columnas, como las pinta la cuadrícula
function colocar(diseno) {
  let x = 0, y = 0, alto = 0;
  for (const b of diseno.bloques) {
    b.w = Math.max(2, Math.min(COLUMNAS, Number(b.w) || 4));
    b.h = Math.max(1, Math.min(6, Number(b.h) || 2));
    if (x + b.w > COLUMNAS) { x = 0; y += alto; alto = 0; }
    b.x = x; b.y = y;
    x += b.w; alto = Math.max(alto, b.h);
  }
  return diseno;
}
const ordenar = d => { d.bloques.sort((a, b) => (a.y - b.y) || (a.x - b.x)); return d; };
const copia = o => JSON.parse(JSON.stringify(o));

export function crear(el, { soloLectura = false } = {}) {
  let indice = null, diseno = null, guardado = null, editando = false, error = null, cambiado = false;
  let mesVista = '';            // el mes del selector
  const meses = new Map();      // mes → datos de direccion:<mes> (o null si no está publicado)
  const graficas = new Map();   // id del bloque → instancia de Chart

  const catalogo = () => indice?.catalogo || [];
  const indicador = id => catalogo().find(c => c.id === id);
  const listaMeses = () => [...(indice?.meses || [])].sort();
  const ultimoMes = () => listaMeses().at(-1);

  // Todos los bloques siguen al mes elegido arriba: «mes» → ese mes; «últimos N» → los N que terminan en él;
  // «rango» → el rango guardado en el bloque. Un `periodo.mes` de un diseño antiguo se ignora.
  function mesesDe(p = {}) {
    const todos = listaMeses();
    if (p.modo === 'ultimos') return todos.filter(m => m <= mesVista).slice(-Math.max(1, Number(p.n) || 6));
    if (p.modo === 'rango') return todos.filter(m => (!p.desde || m >= p.desde) && (!p.hasta || m <= p.hasta));
    return [mesVista].filter(Boolean);
  }
  async function datosMes(mes) {
    if (!meses.has(mes)) meses.set(mes, api.leerPublicada(`direccion:${mes}`).then(f => f?.datos || null).catch(() => null));
    return meses.get(mes);
  }

  async function cargar() {
    error = null;
    pintar();
    try {
      const fila = await api.leerPublicada('direccion:indice');
      if (!fila) throw new Error('El índice de la Dirección (direccion:indice) aún no está publicado en Supabase.');
      indice = fila.datos;
      const recordado = mesVista || mesRecordado();
      mesVista = listaMeses().includes(recordado) ? recordado : mesPorDefecto(listaMeses());
      let propio = null;
      try { propio = await api.leerDiseno(); } catch (e) { avisar(e.message, 'aviso', 10000); }
      guardado = propio?.bloques?.length ? propio : null;
      diseno = copia(guardado || disenoInicial(catalogo()));
      ordenar(diseno);
    } catch (e) { error = e; }
    pintar();
  }

  // ── Pintado ──
  function destruirGraficas() { graficas.forEach(g => g.destroy()); graficas.clear(); }

  function pintar() {
    destruirGraficas();
    if (error) { el.innerHTML = cajaError(error, 'No se ha podido cargar el dashboard de la Dirección') + '<button class="boton" data-tablero="recargar">Reintentar</button>'; return; }
    if (!diseno) { el.innerHTML = '<p class="cargando">Cargando el dashboard de la Dirección…</p>'; return; }
    el.innerHTML = `
      <div class="barra tablero-barra">
        <label class="selector-mes">Mes
          <select data-tablero-mes aria-label="Mes que se muestra">${listaMeses().reverse().map(m => `<option value="${esc(m)}" ${m === mesVista ? 'selected' : ''}>${esc(mesTexto(m))}${m === mesEnCurso() ? ' (en curso)' : ''}</option>`).join('')}</select>
        </label>
        ${mesVista === mesEnCurso() ? '<span class="insignia aviso">Mes en curso · datos parciales</span>' : ''}
        <p class="tenue">${editando ? 'Modo edición: añade, quita, mueve y cambia el tamaño de los bloques. Nada se guarda hasta pulsar «Guardar diseño».' : `Datos publicados hasta ${esc(mesTexto(ultimoMes() || ''))}. Solo cambia el diseño: los datos no se editan aquí.`}</p>
        <span class="empuje"></span>
        ${soloLectura ? '' : editando ? `
          <button class="boton secundario" data-tablero="anadir">Añadir bloque</button>
          <button class="boton secundario" data-tablero="restablecer">Restablecer diseño</button>
          <button class="boton secundario" data-tablero="descartar">Descartar</button>
          <button class="boton" data-tablero="guardar" ${cambiado ? '' : 'disabled'}>Guardar diseño</button>`
        : '<button class="boton secundario" data-tablero="editar">Editar diseño</button>'}
      </div>
      <div class="cuadricula-tablero ${editando ? 'editando' : ''}">
        ${diseno.bloques.map((b, i) => bloqueHtml(b, i)).join('') || '<p class="vacio">No hay bloques. Pulsa «Editar diseño» → «Añadir bloque».</p>'}
      </div>`;
    diseno.bloques.forEach(b => rellenar(b));
  }

  function bloqueHtml(b, i) {
    const c = indicador(b.indicador);
    const ultimo = i === diseno.bloques.length - 1;
    return `<article class="bloque-tablero tipo-${esc(b.tipo)}" style="--w:${b.w};--h:${b.h}" data-bloque="${esc(b.id)}">
      <header><div class="titulo-bloque"><h3>${esc(b.titulo || c?.titulo || b.indicador)}</h3><p class="periodo-bloque">${esc(textoPeriodo(mesesDe(b.periodo)))}</p></div>
        ${editando ? `<div class="mandos-bloque">
          <button type="button" class="boton secundario mini" data-tablero="configurar" data-id="${esc(b.id)}" title="Indicador, tipo, periodo y vista">Configurar</button>
          <button type="button" class="mini-icono" data-tablero="mover" data-dir="-1" data-id="${esc(b.id)}" ${i === 0 ? 'disabled' : ''} aria-label="Mover antes">←</button>
          <button type="button" class="mini-icono" data-tablero="mover" data-dir="1" data-id="${esc(b.id)}" ${ultimo ? 'disabled' : ''} aria-label="Mover después">→</button>
          <button type="button" class="mini-icono" data-tablero="ancho" data-dir="-1" data-id="${esc(b.id)}" ${b.w <= 2 ? 'disabled' : ''} aria-label="Más estrecho">⇠</button>
          <button type="button" class="mini-icono" data-tablero="ancho" data-dir="1" data-id="${esc(b.id)}" ${b.w >= COLUMNAS ? 'disabled' : ''} aria-label="Más ancho">⇢</button>
          <button type="button" class="mini-icono" data-tablero="alto" data-dir="-1" data-id="${esc(b.id)}" ${b.h <= 1 ? 'disabled' : ''} aria-label="Más bajo">⇡</button>
          <button type="button" class="mini-icono" data-tablero="alto" data-dir="1" data-id="${esc(b.id)}" ${b.h >= 6 ? 'disabled' : ''} aria-label="Más alto">⇣</button>
          <button type="button" class="mini-icono peligro" data-tablero="quitar" data-id="${esc(b.id)}" aria-label="Quitar bloque">✕</button>
        </div>` : ''}
      </header>
      <div class="contenido-bloque"><p class="cargando">Cargando…</p></div>
      <footer class="pie-bloque">${c ? `Fuente: ${esc(c.bloque || '—')}` : '<span class="insignia error">Indicador que ya no está en el catálogo</span>'}<span class="nota-bloque"></span></footer>
    </article>`;
  }

  // Serie de un indicador en una lista de meses: { meses, totales, equipos: Map(equipo → valores), notas }
  async function serie(b, lista) {
    const datos = await Promise.all(lista.map(datosMes));
    const equipos = new Map(), notas = new Set();
    const totales = datos.map((d, i) => {
      const x = d?.indicadores?.[b.indicador];
      if (x?.nota) notas.add(x.nota);
      if (x?.pendiente) notas.add(typeof x.pendiente === 'string' ? x.pendiente : 'Pendiente: aún sin fuente de datos.');
      if (!d) notas.add(`${mesTexto(lista[i])}: no publicado.`);
      for (const [eq, v] of Object.entries(x?.porEquipo || {})) {
        if (!equipos.has(eq)) equipos.set(eq, lista.map(() => null));
        equipos.get(eq)[i] = v ?? null;
      }
      return x?.pendiente || x?.total === undefined ? null : x.total;
    });
    return { meses: lista, totales, equipos, notas: [...notas], datos };
  }

  async function rellenar(b) {
    const art = el.querySelector(`[data-bloque="${CSS.escape(b.id)}"]`);
    if (!art) return;
    const caja = art.querySelector('.contenido-bloque'), nota = art.querySelector('.nota-bloque');
    const c = indicador(b.indicador);
    if (!c) { caja.innerHTML = '<p class="vacio">—</p>'; return; }
    try {
      const s = await serie(b, mesesDe(b.periodo));
      if (!art.isConnected) return;
      const notas = [...new Set([c.nota, c.pendiente ? (typeof c.pendiente === 'string' ? c.pendiente : 'Pendiente: aún sin fuente de datos.') : null, ...s.notas].filter(Boolean))];
      nota.textContent = notas.length ? ' · ' + notas.join(' · ') : '';
      const porEquipo = b.vista === 'equipo' && c.porEquipo && s.equipos.size;
      const ultimo = s.meses.length - 1;
      if (b.tipo === 'cifra') {
        const v = s.totales[ultimo], ant = s.totales[ultimo - 1];
        caja.innerHTML = `<div class="cifra-bloque">${esc(formato(v, c.unidad))}</div>
          ${ant !== undefined && ant !== null && v !== null && v !== undefined ? `<p class="tenue">${esc(mesTexto(s.meses[ultimo - 1]))}: ${esc(formato(ant, c.unidad))}</p>` : ''}
          ${porEquipo ? `<ul class="lista-equipos">${[...s.equipos].map(([eq, vals]) => `<li><span>${esc(eq)}</span><strong>${esc(formato(vals[ultimo], c.unidad))}</strong></li>`).join('')}</ul>` : ''}`;
        return;
      }
      if (b.tipo === 'tabla') { caja.innerHTML = tabla(b, c, s); return; }
      if (s.totales.every(v => v === null) && ![...s.equipos.values()].some(vs => vs.some(v => v !== null))) {
        caja.innerHTML = '<div class="cifra-bloque">—</div><p class="tenue">Sin datos para este periodo.</p>';
        return;
      }
      const Chart = await chartJs();
      if (!art.isConnected) return;
      caja.innerHTML = '<div class="lienzo-bloque"><canvas></canvas></div>';
      graficas.get(b.id)?.destroy();
      graficas.set(b.id, new Chart(caja.querySelector('canvas'), configGrafica(b, c, s, porEquipo)));
    } catch (e) {
      caja.innerHTML = `<p class="error">${esc(e.message || e)}</p>`;
    }
  }

  function configGrafica(b, c, s, porEquipo) {
    const etiquetasMes = s.meses.map(m => mesTexto(m).replace(/ de (\d{4})$/, ' $1'));
    const ultimo = s.meses.length - 1;
    let labels, datasets;
    if (b.tipo === 'quesito') {
      const eqs = [...s.equipos];
      labels = eqs.length ? eqs.map(([eq]) => eq) : ['Total'];
      datasets = [{ data: eqs.length ? eqs.map(([, v]) => v[ultimo]) : [s.totales[ultimo]], backgroundColor: PALETA }];
    } else if (porEquipo && b.tipo === 'barras' && s.meses.length === 1) {
      labels = [...s.equipos.keys()];
      datasets = [{ label: etiquetasMes[0], data: [...s.equipos.values()].map(v => v[0]), backgroundColor: PALETA[0] }];
    } else if (porEquipo) {
      labels = etiquetasMes;
      datasets = [...s.equipos].map(([eq, v], i) => ({ label: eq, data: v, backgroundColor: PALETA[i % PALETA.length], borderColor: PALETA[i % PALETA.length], tension: .25, spanGaps: false }));
    } else {
      labels = etiquetasMes;
      datasets = [{ label: c.titulo, data: s.totales, backgroundColor: PALETA[0], borderColor: PALETA[0], tension: .25, spanGaps: false }];
    }
    const tipo = { barras: 'bar', linea: 'line', quesito: 'doughnut' }[b.tipo] || 'bar';
    return {
      type: tipo,
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: {
          legend: { display: tipo === 'doughnut' || datasets.length > 1, position: 'bottom', labels: { boxWidth: 10, font: { family: 'Manrope' } } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label && tipo !== 'doughnut' ? ctx.dataset.label + ': ' : ctx.label ? ctx.label + ': ' : ''}${formato(ctx.raw, c.unidad)}` } },
        },
        scales: tipo === 'doughnut' ? {} : { y: { ticks: { callback: v => formato(v, c.unidad) }, grid: { color: 'rgba(24,32,72,.07)' } }, x: { grid: { display: false } } },
      },
    };
  }

  function tabla(b, c, s) {
    const ultimo = s.meses.length - 1;
    const x = s.datos[ultimo]?.indicadores?.[b.indicador];
    // Indicadores con tabla propia (var.porTecnico: filas { nombre, unidad, rentabilidad, variable })
    if (x?.filas || c.tabla) {
      const filas = x?.filas || [];
      if (!filas.length) return '<div class="cifra-bloque">—</div><p class="tenue">Sin filas este mes.</p>';
      const cols = Object.keys(filas[0]);
      const numerica = k => filas.every(f => f[k] === null || typeof f[k] === 'number');
      const nombres = { nombre: 'Nombre', unidad: 'Unidad', rentabilidad: 'Rentabilidad', variable: 'Variable' };
      return `<div class="tabla-scroll"><table>
        <thead><tr>${cols.map(k => `<th class="${numerica(k) ? 'num' : ''}">${esc(nombres[k] || k)}</th>`).join('')}</tr></thead>
        <tbody>${filas.map(f => `<tr>${cols.map(k => `<td class="${numerica(k) ? 'num' : ''}">${esc(numerica(k) ? formato(f[k], ['rentabilidad', 'variable'].includes(k) ? '€' : '') : (f[k] ?? '—'))}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`;
    }
    const porEquipo = b.vista === 'equipo' && c.porEquipo && s.equipos.size;
    const cols = porEquipo ? [...s.equipos.keys()] : ['Total'];
    return `<div class="tabla-scroll"><table>
      <thead><tr><th>Mes</th>${cols.map(k => `<th class="num">${esc(k)}</th>`).join('')}</tr></thead>
      <tbody>${s.meses.map((m, i) => `<tr><td>${esc(mesTexto(m))}</td>${porEquipo
        ? [...s.equipos.values()].map(v => `<td class="num">${esc(formato(v[i], c.unidad))}</td>`).join('')
        : `<td class="num">${esc(formato(s.totales[i], c.unidad))}</td>`}</tr>`).join('')}</tbody>
    </table></div>`;
  }

  // ── Edición del diseño ──
  function marcar() { cambiado = true; colocar(diseno); pintar(); }
  const bloque = id => diseno.bloques.find(b => b.id === id);

  async function configurar(b) {
    const nuevo = !b;
    let v = b ? { ...b, ...b.periodo } : { indicador: catalogo().find(c => !c.pendiente)?.id || catalogo()[0]?.id, tipo: 'barras', modo: 'ultimos', n: 6, vista: 'total', titulo: '' };
    const ms = listaMeses();
    const opcionMes = sel => ms.map(m => `<option value="${esc(m)}" ${sel === m ? 'selected' : ''}>${esc(mesTexto(m))}</option>`).join('');
    const tipos = indice?.tiposGrafica?.length ? indice.tiposGrafica : Object.keys(TIPOS);
    const form = await preguntar(nuevo ? 'Añadir bloque' : 'Configurar bloque', `
      <label>Indicador<select name="indicador" required>${catalogo().map(c => `<option value="${esc(c.id)}" ${v.indicador === c.id ? 'selected' : ''}>${esc(c.titulo)}${c.pendiente ? ' (pendiente)' : ''}</option>`).join('')}</select></label>
      <label>Título <span class="tenue">(vacío = el del indicador)</span><input name="titulo" value="${esc(v.titulo || '')}" maxlength="80"></label>
      <div class="fila-campos">
        <label>Tipo<select name="tipo">${tipos.map(t => `<option value="${esc(t)}" ${v.tipo === t ? 'selected' : ''}>${esc(TIPOS[t] || t)}</option>`).join('')}</select></label>
        <label>Vista<select name="vista"><option value="total" ${v.vista !== 'equipo' ? 'selected' : ''}>Total</option><option value="equipo" ${v.vista === 'equipo' ? 'selected' : ''}>Por equipo</option></select></label>
      </div>
      <fieldset class="grupo-equipo"><legend>Periodo</legend>
        <div class="fila-campos">
          <label>Modo<select name="modo">
            <option value="mes" ${v.modo === 'mes' ? 'selected' : ''}>El mes del selector</option>
            <option value="ultimos" ${v.modo === 'ultimos' ? 'selected' : ''}>Últimos N meses (hasta el del selector)</option>
            <option value="rango" ${v.modo === 'rango' ? 'selected' : ''}>Rango fijo</option></select></label>
          <label>N <span class="tenue">(últimos)</span><input type="number" name="n" min="1" max="24" value="${esc(v.n || 6)}"></label>
        </div>
        <div class="fila-campos">
          <label>Desde <span class="tenue">(rango)</span><select name="desde"><option value="">El primero</option>${opcionMes(v.desde)}</select></label>
          <label>Hasta <span class="tenue">(rango)</span><select name="hasta"><option value="">El último</option>${opcionMes(v.hasta)}</select></label>
        </div>
      </fieldset>
      <p class="tenue">«Por equipo» solo vale para los indicadores que lo traen; si no, se enseña el total.</p>`,
    { aceptar: nuevo ? 'Añadir' : 'Aplicar' });
    if (!form) return;
    const f = Object.fromEntries(new FormData(form));
    const c = indicador(f.indicador);
    const periodo = f.modo === 'ultimos' ? { modo: 'ultimos', n: Math.max(1, Math.min(24, Number(f.n) || 6)) }
      : f.modo === 'rango' ? { modo: 'rango', ...(f.desde ? { desde: f.desde } : {}), ...(f.hasta ? { hasta: f.hasta } : {}) }
      : { modo: 'mes' };
    const datos = { indicador: f.indicador, tipo: f.tipo, periodo, vista: f.vista === 'equipo' && c?.porEquipo ? 'equipo' : 'total', ...(f.titulo.trim() ? { titulo: f.titulo.trim() } : {}) };
    if (nuevo) diseno.bloques.push({ id: nuevoId(), w: f.tipo === 'cifra' ? 3 : 6, h: f.tipo === 'cifra' ? 2 : 3, ...datos });
    else { delete b.titulo; Object.assign(b, datos); }
    marcar();
  }

  async function alPulsar(ev) {
    const t = ev.target.closest('[data-tablero]');
    if (!t || !el.contains(t)) return;
    const accion = t.dataset.tablero, b = t.dataset.id ? bloque(t.dataset.id) : null;
    if (accion === 'recargar') return cargar();
    if (accion === 'editar') { editando = true; cambiado = false; pintar(); return; }
    if (accion === 'descartar') {
      if (cambiado && !confirm('¿Descartar los cambios del diseño?')) return;
      diseno = ordenar(copia(guardado || disenoInicial(catalogo()))); editando = false; cambiado = false; pintar(); return;
    }
    if (accion === 'anadir') return configurar(null);
    if (accion === 'configurar' && b) return configurar(b);
    if (accion === 'quitar' && b) { diseno.bloques = diseno.bloques.filter(x => x !== b); return marcar(); }
    if (accion === 'mover' && b) {
      const i = diseno.bloques.indexOf(b), j = i + Number(t.dataset.dir);
      if (j < 0 || j >= diseno.bloques.length) return;
      [diseno.bloques[i], diseno.bloques[j]] = [diseno.bloques[j], diseno.bloques[i]];
      return marcar();
    }
    if (accion === 'ancho' && b) { b.w = Math.max(2, Math.min(COLUMNAS, b.w + Number(t.dataset.dir))); return marcar(); }
    if (accion === 'alto' && b) { b.h = Math.max(1, Math.min(6, b.h + Number(t.dataset.dir))); return marcar(); }
    if (accion === 'restablecer') {
      const ok = await preguntar('Restablecer diseño', '<p>Se borra tu diseño guardado y vuelve el diseño inicial.</p>', { aceptar: 'Restablecer', peligro: true });
      if (!ok) return;
      try { await api.borrarDiseno(); guardado = null; diseno = ordenar(disenoInicial(catalogo())); editando = false; cambiado = false; avisar('Diseño restablecido.'); }
      catch (e) { avisar(e.message, 'error', 10000); }
      pintar();
      return;
    }
    if (accion === 'guardar') {
      t.disabled = true;
      try {
        colocar(diseno);
        await api.guardarDiseno(diseno);
        guardado = copia(diseno); editando = false; cambiado = false;
        avisar('Diseño guardado.');
      } catch (e) { avisar(e.message, 'error', 10000); t.disabled = false; return; }
      pintar();
    }
  }

  // Cambiar de mes no toca el diseño: solo vuelve a pintar los bloques con el mes nuevo
  function alCambiarMes(ev) {
    if (!ev.target.matches?.('[data-tablero-mes]')) return;
    mesVista = ev.target.value;
    recordarMes(mesVista);
    pintar();
  }

  el.addEventListener('click', alPulsar);
  el.addEventListener('change', alCambiarMes);
  cargar();
  return {
    pendiente: () => editando && cambiado,
    recargar: () => { meses.clear(); return cargar(); },
    desmontar() { el.removeEventListener('click', alPulsar); el.removeEventListener('change', alCambiarMes); destruirGraficas(); },
  };
}
