// Página de la Dirección General (direccion.html): indicadores del puesto, solo lectura.
// Acceso propio (rol «direccion»): su testigo se guarda aparte y solo sirve para las acciones direccion*.
// Mientras el backend no las publique en el ping, se enseñan datos de ejemplo claramente marcados.
import * as api from './api.js?v=24';
import { esc, fecha, avisar, cajaError, mesActual, sumarMeses } from './ui.js?v=24';

const $ = s => document.querySelector(s);
const CLAVE_TESTIGO = 'bufala-direccion-testigo';

// ── Sesión de la Dirección (separada de la del panel) ──
function testigo() {
  try {
    const t = JSON.parse(sessionStorage.getItem(CLAVE_TESTIGO) || 'null');
    if (!t?.token) return null;
    if (t.caduca && Date.parse(t.caduca) <= Date.now()) { olvidarTestigo(); return null; }
    return t.token;
  } catch { return null; }
}
function guardarTestigo(token, caduca) { try { sessionStorage.setItem(CLAVE_TESTIGO, JSON.stringify({ token, caduca })); } catch { /* solo esta pestaña */ } }
function olvidarTestigo() { try { sessionStorage.removeItem(CLAVE_TESTIGO); } catch { /* nada */ } }

// ── Periodos ──
const dos = n => String(n).padStart(2, '0');
// Semana ISO 8601 de una fecha: { anio, semana }
function semanaIso(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dia = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - dia);
  const inicio = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return { anio: x.getUTCFullYear(), semana: Math.ceil(((x - inicio) / 86400000 + 1) / 7) };
}
const aSemanaApi = valorInput => valorInput ? valorInput.replace('-W', '-S') : '';     // 2026-W39 → 2026-S39
const aSemanaInput = valorApi => valorApi ? valorApi.replace('-S', '-W') : '';
const semanaPasada = () => { const d = new Date(); d.setDate(d.getDate() - 7); const s = semanaIso(d); return `${s.anio}-W${dos(s.semana)}`; };
function trimestreDe(mes) { const [a, m] = mes.split('-').map(Number); return `${a}-T${Math.ceil(m / 3)}`; }
function trimestresRecientes(n = 8) {
  const lista = [];
  let mes = mesActual();
  for (let i = 0; i < n; i++) { const t = trimestreDe(mes); if (!lista.includes(t)) lista.push(t); mes = sumarMeses(mes, -3); }
  return lista;
}
const nombreTrimestre = t => { const [a, q] = t.split('-T'); return `${q}.º trimestre de ${a}`; };

let periodo = {
  semana: semanaPasada(),                          // la última semana completa
  mes: sumarMeses(mesActual(), -1),                // el último mes cerrado
  trimestre: trimestreDe(sumarMeses(mesActual(), -3)),
};
let semanaInforme = semanaPasada();
let datos = null, errorCarga = null, cargando = false;
let informe = null, errorInforme = null, cargandoInforme = false;
let enProduccion = new Set();

// ── Formato ──
const fmtNum = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
function valorTexto(ind) {
  if (ind.datoManual) return '<span class="insignia aviso" title="El sistema no captura este dato: hay que aportarlo a mano">dato manual</span>';
  if (ind.valor === null || ind.valor === undefined || ind.valor === '') return '<span class="tenue">sin datos</span>';
  let v = Number(ind.valor), u = ind.unidad || '';
  if (Number.isNaN(v)) return esc(ind.valor);
  if (u === '%' && Math.abs(v) <= 1.5) v *= 100;     // los porcentajes pueden llegar como fracción
  if (u === '€') return esc(new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v));
  return `${esc(fmtNum.format(v))}${u ? `<span class="ind-unidad">${u === '%' ? '%' : ' ' + esc(u)}</span>` : ''}`;
}
const pct = v => (v === null || v === undefined || v === '') ? '—' : `${fmtNum.format(Math.abs(v) <= 1.5 ? v * 100 : v)} %`;

function tarjeta(ind) {
  return `<article class="indicador ${ind.datoManual ? 'manual' : ''}">
    <header><h3>${esc(ind.nombre || ind.clave)}</h3><span class="insignia">${esc(ind.periodicidad || '')}</span></header>
    <div class="indicador-valor">${valorTexto(ind)}</div>
    ${ind.nota ? `<p class="tenue indicador-nota">${esc(ind.nota)}</p>` : ''}
    ${ind.formula ? `<details><summary>Fórmula</summary><p>${esc(ind.formula)}</p></details>` : ''}
  </article>`;
}

// ── Datos ──
const usaDemo = accion => !enProduccion.has(accion);

async function pedir(accion, params) {
  if (usaDemo(accion)) return demostracion(accion, params);
  try {
    return await api.peticionDireccion(accion, { params, testigo: testigo() });
  } catch (e) {
    if (e.tipo === 'sesion') { olvidarTestigo(); await pedirAcceso('La sesión ha caducado. Vuelve a entrar.'); return api.peticionDireccion(accion, { params, testigo: testigo() }); }
    throw e;
  }
}

async function cargarIndicadores() {
  cargando = true; errorCarga = null; pintar();
  try {
    datos = await pedir('direccionIndicadores', { semana: aSemanaApi(periodo.semana), mes: periodo.mes, trimestre: periodo.trimestre });
  } catch (e) { errorCarga = e; }
  cargando = false; pintar();
}

async function cargarInforme() {
  cargandoInforme = true; errorInforme = null; informe = null; pintar();
  try {
    informe = await pedir('direccionInforme', { semana: aSemanaApi(semanaInforme) });
  } catch (e) { errorInforme = e; }
  cargandoInforme = false; pintar();
}

function descargar(texto, nombre, tipo) {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Pintado ──
function seccion(id, titulo, periodicidad, selector, cuerpo) {
  return `<section class="bloque seccion-direccion" id="${id}">
    <div class="barra" style="align-items:end;margin-bottom:.75rem">
      <div><span class="periodicidad">${esc(periodicidad)}</span><h2 style="margin:0">${esc(titulo)}</h2></div>
      <span class="empuje"></span>${selector}
    </div>${cuerpo}</section>`;
}

function pintar() {
  const el = $('#vista');
  const d = datos;
  const cabecera = `<div class="barra">
      <div><h1>Indicadores de Operaciones</h1>
        <p class="tenue">Obligaciones de la Dirección de Operaciones (Descripción de Funciones v2.0, §8 y §5.11.1). Solo lectura.${d?.generado ? ` Datos generados el ${fecha(d.generado)} a las ${esc(String(d.generado).slice(11, 16))}.` : ''}</p></div>
    </div>`;
  if (!d && cargando) { el.innerHTML = cabecera + '<p class="cargando">Cargando indicadores…</p>'; return; }
  if (!d && errorCarga) { el.innerHTML = cabecera + cajaError(errorCarga, 'No se han podido cargar los indicadores') + '<button class="boton" data-accion="recargar">Reintentar</button>'; return; }
  if (!d) return;

  const sem = d.semanal || {}, men = d.mensual || {}, tri = d.trimestral || {};
  const lista = inds => (inds || []).length ? `<div class="indicadores">${inds.map(tarjeta).join('')}</div>` : '<p class="vacio">Sin indicadores para este periodo.</p>';
  const columnasEquipo = [...new Set((sem.porEquipo || []).flatMap(f => Object.keys(f)).filter(k => k !== 'equipo'))];
  const nombreColumna = { ocupacion: 'Ocupación efectiva', productividad: 'Productividad' };

  el.innerHTML = cabecera + `
    ${errorCarga ? cajaError(errorCarga, 'No se han podido actualizar los indicadores') : ''}
    <nav class="saltos" aria-label="Secciones">
      <a href="#semanal">Semanal</a><a href="#mensual">Mensual</a><a href="#trimestral">Trimestral</a><a href="#por-alta">Por incorporación</a><a href="#informe">Informe Semanal</a>
    </nav>
    ${seccion('semanal', sem.desde ? `Semana ${esc(sem.semana || '')} · del ${fecha(sem.desde)} al ${fecha(sem.hasta)}` : 'Semana', 'Semanal',
      `<label>Semana<input type="week" id="p-semana" value="${esc(periodo.semana)}" required></label>`,
      lista(sem.indicadores) + ((sem.porEquipo || []).length ? `<h3 class="subtitulo">Por equipo</h3><div class="tabla-scroll"><table>
        <thead><tr><th>Equipo</th>${columnasEquipo.map(c => `<th class="num">${esc(nombreColumna[c] || c)}</th>`).join('')}</tr></thead>
        <tbody>${sem.porEquipo.map(f => `<tr><td><strong>${esc(f.equipo)}</strong></td>${columnasEquipo.map(c =>
          `<td class="num">${c === 'ocupacion' ? pct(f[c]) : (f[c] === null || f[c] === undefined ? '—' : esc(typeof f[c] === 'number' ? fmtNum.format(f[c]) : f[c]))}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>` : ''))}
    ${seccion('mensual', men.mes ? `Mes de ${esc(nombreMesLargo(men.mes))}` : 'Mes', 'Mensual',
      `<label>Mes<input type="month" id="p-mes" value="${esc(periodo.mes)}" required></label>`, lista(men.indicadores))}
    ${seccion('trimestral', tri.trimestre ? nombreTrimestre(tri.trimestre) : 'Trimestre', 'Trimestral',
      `<label>Trimestre<select id="p-trimestre">${trimestresRecientes().map(t => `<option value="${t}" ${t === periodo.trimestre ? 'selected' : ''}>${esc(nombreTrimestre(t))}</option>`).join('')}</select></label>`,
      lista(tri.indicadores))}
    ${seccion('por-alta', 'Incorporaciones', 'Por incorporación', '',
      `<p class="tenue">Días desde el alta hasta que el técnico trabaja con autonomía.</p>
      <div class="tabla-scroll"><table>
        <thead><tr><th>Técnico</th><th>Alta</th><th class="num">Días hasta autonomía</th></tr></thead>
        <tbody>${(d.porAlta || []).map(f => `<tr><td><strong>${esc(f.tecnico)}</strong></td><td>${fecha(f.alta)}</td>
          <td class="num">${f.datoManual ? '<span class="insignia aviso">dato manual</span>' : f.diasHastaAutonomia === null || f.diasHastaAutonomia === undefined ? '<span class="tenue">en curso</span>' : esc(f.diasHastaAutonomia)}</td></tr>`).join('')
          || '<tr><td colspan="3" class="vacio">No hay incorporaciones.</td></tr>'}</tbody>
      </table></div>`)}
    ${seccion('informe', 'Informe Semanal', 'Semanal · §5.11.1',
      `<label>Semana<input type="week" id="p-informe" value="${esc(semanaInforme)}" required></label>
       <button class="boton" data-accion="informe" ${cargandoInforme ? 'disabled' : ''}>${cargandoInforme ? 'Preparando…' : 'Ver informe'}</button>`,
      errorInforme ? cajaError(errorInforme, 'No se ha podido preparar el informe')
      : informe ? `<div class="barra" style="align-items:center">
            <strong>${esc(nombreInforme())}</strong><span class="empuje"></span>
            <button class="boton secundario" data-accion="descargar-md">Descargar .md</button>
            <button class="boton secundario" data-accion="descargar-csv" ${informe.csv ? '' : 'disabled'}>Descargar .csv</button></div>
          <pre class="informe-md">${esc(informe.md || '')}</pre>`
      : '<p class="tenue">Elige la semana y pulsa «Ver informe» para verlo y descargarlo en .md y .csv.</p>')}`;
}
const nombreMesLargo = mes => new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(new Date(mes + '-01T12:00'));
const nombreInforme = () => informe?.nombre || `BUFALA_Informe_Operaciones_${aSemanaApi(semanaInforme)}`;

// ── Eventos ──
$('#vista').addEventListener('change', ev => {
  const t = ev.target;
  if (t.id === 'p-semana' && t.value) { periodo.semana = t.value; cargarIndicadores(); }
  if (t.id === 'p-mes' && t.value) { periodo.mes = t.value; cargarIndicadores(); }
  if (t.id === 'p-trimestre') { periodo.trimestre = t.value; cargarIndicadores(); }
  if (t.id === 'p-informe' && t.value) { semanaInforme = t.value; informe = null; errorInforme = null; pintar(); }
});
$('#vista').addEventListener('click', ev => {
  const b = ev.target.closest('[data-accion]');
  if (!b) return;
  const a = b.dataset.accion;
  if (a === 'recargar') cargarIndicadores();
  if (a === 'informe') cargarInforme();
  if (a === 'descargar-md' && informe) descargar(informe.md || '', nombreInforme().replace(/\.(md|csv)$/i, '') + '.md', 'text/markdown;charset=utf-8');
  if (a === 'descargar-csv' && informe?.csv) descargar('﻿' + informe.csv, nombreInforme().replace(/\.(md|csv)$/i, '') + '.csv', 'text/csv;charset=utf-8');
});

// ── Acceso ──
let esperaAcceso = null;
function pedirAcceso(motivo) {
  if (esperaAcceso) return esperaAcceso;
  $('#acceso-motivo').textContent = motivo || 'Introduce la contraseña de la Dirección.';
  $('#acceso-error').hidden = true;
  $('#clave').value = '';
  $('#acceso').hidden = false;
  $('#salir').hidden = true;
  setTimeout(() => $('#clave').focus(), 0);
  esperaAcceso = new Promise(r => { $('#acceso')._resolver = r; });
  return esperaAcceso;
}
$('#form-acceso').addEventListener('submit', async ev => {
  ev.preventDefault();
  const boton = ev.target.querySelector('button');
  boton.disabled = true; boton.textContent = 'Comprobando…';
  try {
    const r = await api.peticionDireccion('direccionLogin', { metodo: 'POST', cuerpo: { clave: $('#clave').value } });
    if (!r.token) throw new Error('El servidor no ha devuelto el testigo de sesión.');
    guardarTestigo(r.token, r.caduca);
    $('#clave').value = '';
    $('#acceso').hidden = true;
    $('#salir').hidden = false;
    const resolver = $('#acceso')._resolver; esperaAcceso = null; resolver && resolver();
  } catch (e) {
    $('#acceso-error').textContent = e.message || 'Contraseña incorrecta.';
    $('#acceso-error').hidden = false;
    $('#clave').select();
  } finally {
    boton.disabled = false; boton.textContent = 'Entrar';
  }
});
$('#salir').addEventListener('click', () => { olvidarTestigo(); location.reload(); });

api.alCambiarConexion((ok, detalle) => {
  const f = $('#franja');
  if (ok) { f.hidden = true; return; }
  f.innerHTML = `<span><strong>Sin conexión con el servidor.</strong> ${esc(detalle || '')}</span>`;
  f.hidden = false;
});
api.alReintentar(() => avisar('Reintentando… El servidor no ha contestado bien a la primera.', 'aviso', 6000));

// ── Arranque ──
(async function arrancar() {
  try {
    enProduccion = await api.accionesEnProduccion();
  } catch (e) {
    $('#vista').innerHTML = '<h1>Indicadores de Operaciones</h1>' + cajaError(e, 'No se puede contactar con el servidor') + '<button class="boton" onclick="location.reload()">Reintentar</button>';
    return;
  }
  const demo = api.TODAS_DIRECCION.filter(a => a !== 'direccionLogin' && usaDemo(a));
  if (demo.length) {
    const f = $('#franja-demo');
    f.innerHTML = '<strong>Datos de ejemplo.</strong> '
      + (enProduccion.has('direccionLogin') ? 'El acceso ya es real, pero ' : 'El servidor todavía no tiene activada esta página: ')
      + 'los indicadores que se ven son de demostración y no corresponden a la empresa.';
    f.hidden = false;
  }
  // El acceso solo se pide cuando el servidor lo tiene; la demostración no enseña nada real
  if (enProduccion.has('direccionLogin')) {
    if (!testigo()) await pedirAcceso();
    else $('#salir').hidden = false;
  }
  cargarIndicadores();
})();

// ── Demostración (forma exacta de BACKEND.md, encargo del 26/09/2026) ──
async function demostracion(accion, params) {
  await new Promise(r => setTimeout(r, 150));
  if (accion === 'direccionIndicadores') {
    const semana = params.semana || aSemanaApi(semanaPasada());
    const [a, s] = semana.split('-S').map(Number);
    const lunes = new Date(Date.UTC(a, 0, 4));
    lunes.setUTCDate(lunes.getUTCDate() - ((lunes.getUTCDay() || 7) - 1) + (s - 1) * 7);
    const iso = d => d.toISOString().slice(0, 10);
    const domingo = new Date(lunes); domingo.setUTCDate(domingo.getUTCDate() + 6);
    const ind = (clave, nombre, periodicidad, valor, unidad, formula, extra = {}) => ({ clave, nombre, periodicidad, valor, unidad, formula, datoManual: false, nota: '', ...extra });
    return {
      ok: true, generado: new Date().toISOString().slice(0, 19),
      semanal: { semana, desde: iso(lunes), hasta: iso(domingo),
        indicadores: [
          ind('ocupacion', 'Ocupación efectiva', 'semanal', 0.81, '%', 'Horas en obra ÷ horas disponibles de los técnicos desplegados'),
          ind('productividad', 'Productividad', 'semanal', 30.4, 'puntos/técnico-día', 'Puntos de obra cerrados ÷ técnicos-día desplegados'),
        ],
        porEquipo: [
          { equipo: 'Búfala 1', ocupacion: 0.86, productividad: 33.1 },
          { equipo: 'Búfala 2', ocupacion: 0.78, productividad: 29.0 },
          { equipo: 'Búfala 3', ocupacion: 0.74, productividad: 27.2 },
        ] },
      mensual: { mes: params.mes,
        indicadores: [
          ind('contribucion', 'Contribución por técnico-día desplegado', 'mensual', 212.5, '€', '(Ingresos − material − coste técnico − coste vehículo) ÷ técnicos-día desplegados'),
          ind('cobertura', 'Cobertura de ausencias', 'mensual', 0.92, '%', 'Días de ausencia cubiertos ÷ días de ausencia'),
          ind('conformes', 'Instalaciones conformes', 'mensual', 0.95, '%', 'Instalaciones sin incidencia en la revisión ÷ instalaciones revisadas'),
          ind('retorno', 'Tasa de retorno', 'mensual', null, '%', 'Obras con segunda visita por fallo propio ÷ obras cerradas', { datoManual: true, nota: 'El sistema no registra todavía las segundas visitas.' }),
          ind('desviacion', 'Desviación de material', 'mensual', 0.034, '%', '(Material consumido − material presupuestado) ÷ material presupuestado'),
        ] },
      trimestral: { trimestre: params.trimestre,
        indicadores: [ind('supervivencia', 'Supervivencia de incorporaciones', 'trimestral', 0.8, '%', 'Técnicos incorporados que siguen a los 90 días ÷ técnicos incorporados')] },
      porAlta: [
        { tecnico: 'María López', alta: '2026-07-13', diasHastaAutonomia: null, datoManual: true },
        { tecnico: 'Elena Martín', alta: '2026-03-02', diasHastaAutonomia: 41, datoManual: false },
      ],
    };
  }
  if (accion === 'direccionInforme') {
    const nombre = `BUFALA_Informe_Operaciones_${params.semana}`;
    return { ok: true, nombre,
      md: `# Informe Semanal de Operaciones · ${params.semana}\n\n_Datos de ejemplo de la demostración._\n\n## Ocupación efectiva\n\n| Equipo | Ocupación | Productividad |\n|---|---|---|\n| Búfala 1 | 86 % | 33,1 |\n| Búfala 2 | 78 % | 29,0 |\n| Búfala 3 | 74 % | 27,2 |\n\n## Incidencias\n\n- Ninguna destacable.\n`,
      csv: 'equipo;ocupacion;productividad\nBúfala 1;0,86;33,1\nBúfala 2;0,78;29,0\nBúfala 3;0,74;27,2\n' };
  }
  throw new Error(`La demostración no conoce «${accion}».`);
}
