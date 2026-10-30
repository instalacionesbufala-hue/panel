// Liquidación mensual: solo lectura. El cálculo lo hace el backend; aquí solo se muestra.
import * as api from './api.js?v=35';
import { ayuda, AYUDA } from './ayudas.js?v=35';
import { esc, eur, fecha, mesActual, nombreMes, cajaError, selectorMes } from './ui.js?v=35';

export function montar(el) {
  let mes = mesActual();
  let liq = null, unidades = null, errorCarga = null, cargando = false;

  async function recargar() {
    errorCarga = null; cargando = true; pintar();
    // La configuración solo hace falta para saber qué unidades no computan variable
    const [l, c] = await Promise.allSettled([api.leerLiquidacion(mes), api.leerConfig()]);
    if (l.status === 'fulfilled') liq = l.value; else errorCarga = l.reason;
    unidades = c.status === 'fulfilled' ? c.value.unidades : null;
    cargando = false; pintar();
  }

  // computaVariable: false ⇒ la unidad y sus técnicos quedan fuera del variable (BACKEND.md).
  // El backend no debería mandar esas filas; si llegan, se apartan y no se muestran como reparto.
  const fueraDelVariable = f => (unidades || []).some(u => u.computaVariable === false && u.id === f.unidad);

  function pintar() {
    const cabecera = `<div class="barra">
        <div><h1>Liquidación</h1><p class="tenue">Cálculo del backend. Esta pantalla no modifica nada.</p></div>
        <span class="empuje"></span>${selectorMes('mes', mes)}
      </div>`;
    if (cargando && (!liq || liq.mes !== mes)) { el.innerHTML = cabecera + '<p class="cargando">Cargando liquidación…</p>'; return; }
    if (errorCarga) { el.innerHTML = cabecera + cajaError(errorCarga, 'No se ha podido cargar la liquidación') + '<button class="boton" data-accion="recargar">Reintentar</button>'; return; }
    if (!liq) return;
    // Desde octubre de 2026 el backend manda el formato del variable v2.1; sin version, el de siempre
    if (String(liq.version) === '2.1') { el.innerHTML = cabecera + pintarV21(); return; }
    const exc = liq.excepciones || [];
    const filas = liq.filas.filter(f => !fueraDelVariable(f));
    const apartadas = liq.filas.length - filas.length;
    const cerrado = String(liq.estado || '').toLowerCase() === 'cerrado';

    el.innerHTML = cabecera + `
      ${exc.length ? `<section class="caja-error bloque" aria-label="Excepciones">
          <h2>${exc.length} excepci${exc.length === 1 ? 'ón' : 'ones'} en ${esc(nombreMes(liq.mes))}</h2>
          <p>Resuélvelas antes de dar el resultado por bueno: hay importes que no se están repartiendo.</p>
          <ul>${exc.map(x => `<li><strong>${esc(x.tipo)}</strong> · ${esc(x.detalle)}</li>`).join('')}</ul>
        </section>` : '<div class="tarjeta bloque"><span class="insignia ok">sin excepciones</span> El backend no ha detectado incidencias este mes.</div>'}

      <div class="barra" style="align-items:center">
        <h2 style="margin:0">${esc(nombreMes(liq.mes))}</h2>
        <span class="insignia ${cerrado ? 'ok' : 'aviso'}">${cerrado ? 'mes cerrado' : 'mes ' + esc(liq.estado || 'abierto') + ': las cifras pueden cambiar'}</span>
      </div>
      <div class="tabla-scroll"><table>
        <thead><tr>
          <th>Técnico</th><th>Unidad</th><th class="num">Obras ${ayuda(AYUDA.obras)}</th><th class="num">Ingresos</th><th class="num">Material</th>
          <th class="num">Coste técnico</th><th class="num">Coste vehículo</th><th class="num">Margen ${ayuda(AYUDA.margen)}</th><th>Tramo ${ayuda(AYUDA.tramo)}</th><th class="num">Variable ${ayuda(AYUDA.variable)}</th>
        </tr></thead>
        <tbody>${filas.map(f => `<tr>
          <td><strong>${esc(f.nombre)}</strong> <span class="tenue">${esc(f.idTec)}</span></td>
          <td>${esc((unidades || []).find(u => u.id === f.unidad)?.nombre || f.unidad || '—')}</td>
          <td class="num">${esc(f.obras ?? '—')}</td>
          <td class="num">${eur(f.ingresos)}</td>
          <td class="num">${eur(f.material)}</td>
          <td class="num">${eur(f.costeTec)} ${f.origenCostes === 'gestoria' ? '' : '<span class="insignia aviso" title="Coste estimado: aún no se ha volcado el de la gestoría">estimado</span>'}</td>
          <td class="num">${eur(f.costeVeh)}</td>
          <td class="num"><strong>${eur(f.margen)}</strong></td>
          <td>${esc(f.tramo || '—')}</td>
          <td class="num"><strong>${eur(f.importe)}</strong></td>
        </tr>`).join('') || '<tr><td colspan="10" class="vacio">No hay datos para este mes.</td></tr>'}</tbody>
        <tfoot><tr><td colspan="9">Total variable del mes</td><td class="num">${eur(liq.total)}</td></tr></tfoot>
      </table></div>
      ${apartadas ? `<div class="caja-aviso">Se han apartado ${apartadas} fila${apartadas === 1 ? '' : 's'} de unidades que no computan variable (SAT, Estructura): no forman parte del reparto. El total es el que manda el servidor; si las incluye, hay que avisar al backend.</div>` : ''}
      ${unidades ? '' : '<p class="tenue">No se ha podido leer la configuración: no se comprueba qué unidades computan variable.</p>'}`;
  }

  // ── Variable v2.1 (BACKEND.md, «Liquidación del variable v2.1», Panel Liquidacion.gs v2.2.2) ──
  // Solo lectura: el mes se congela desde el editor cuando la Dirección General lo valida y los datos se
  // corrigen en su fuente, así que aquí no hay botones de cerrar ni de corregir.
  const nombreUnidad = id => (unidades || []).find(u => u.id === id)?.nombre || id;
  const num = n => (n === null || n === undefined || n === '') ? '—' : Number(n).toLocaleString('es-ES');
  const ESTADOS = { abierto: ['aviso', 'Provisional', 'Se recalcula hasta que la Dirección General lo valide.'],
    cerrado: ['ok', 'Validado y congelado', 'Se sirve tal como se congeló.'], futuro: ['', 'Mes futuro', 'Aún no hay datos.'] };

  function pintarV21() {
    const [clase, estado, explica] = ESTADOS[String(liq.estado || '').toLowerCase()] || ['aviso', liq.estado || 'Provisional', ''];
    const filas = [...(liq.filas || [])].sort((a, b) => (Number(b.rentabilidad) || 0) - (Number(a.rentabilidad) || 0));
    const equipos = liq.equipos || [], primas = liq.primas || [], incid = liq.incidencias || [];
    const fuentes = Object.entries(liq.programadasFuente || {});
    const noTrab = liq.costeNoTrabajado || {};
    const suma = (lista, k) => lista.reduce((s, x) => s + (Number(x[k]) || 0), 0);
    // Excepciones agrupadas por tipo, en el orden en que llegan
    const grupos = new Map();
    for (const x of liq.excepciones || []) grupos.set(x.tipo, [...(grupos.get(x.tipo) || []), x.detalle]);
    const marcaCoste = o => o === 'estimacion' ? ' <span class="insignia aviso" title="Sin nómina del mes: coste estimado">estimado</span>'
      : o === 'sin coste' ? ' <span class="insignia error" title="Sin nómina ni coste de referencia: variable 0">sin coste</span>' : '';
    const informe = `BUFALA_Cierre_Mensual_${liq.mes || mes}`;

    return `
      <div class="bento" aria-label="Resumen de la liquidación">
        <div class="kpi heroe liq-heroe"><div>
          <small>Variable de ${esc(nombreMes(liq.mes || mes))} ${ayuda(AYUDA.variable21)}</small>
          <div class="cifra">${esc(eur(liq.total))}</div>
          <p><span class="insignia ${clase}">${esc(estado)}</span> ${esc(explica)}</p>
        </div></div>
        <div class="kpi"><small>Días laborables ${ayuda(AYUDA.laborables)}</small><div class="cifra">${esc(num(liq.laborables))}</div>
          <span class="tenue">Divisor de los costes diarios</span></div>
        <div class="kpi"><small>Coste de días no trabajados ${ayuda(AYUDA.costeNoTrabajado)}</small>
          <div class="cifra">${esc(eur((Number(noTrab.personal) || 0) + (Number(noTrab.vehiculo) || 0)))}</div>
          <span class="tenue">Personal ${esc(eur(noTrab.personal))} · Vehículo ${esc(eur(noTrab.vehiculo))}</span></div>
      </div>
      ${fuentes.length ? `<p class="tenue">Programadas: ${fuentes.map(([f, d]) => `${esc(f)} (${esc(num(d))} día${Number(d) === 1 ? '' : 's'})`).join(' · ')}</p>` : ''}

      ${grupos.size ? `<section class="caja-aviso bloque" aria-label="Excepciones">
          <h2>Excepciones (${(liq.excepciones || []).length})</h2>
          ${[...grupos].map(([tipo, detalles]) => `<details class="grupo-excepcion"><summary><strong>${esc(tipo)}</strong> <span class="insignia">${detalles.length}</span></summary>
            <ul>${detalles.map(d => `<li>${esc(d)}</li>`).join('')}</ul></details>`).join('')}
        </section>` : '<div class="tarjeta bloque"><span class="insignia ok">sin excepciones</span> El backend no ha detectado excepciones este mes.</div>'}

      <section class="bloque">
        <h2>Por técnico <span class="tenue">· ordenado por rentabilidad</span></h2>
        <div class="tabla-scroll"><table class="tabla-liq">
          <thead><tr><th>Técnico</th><th>Unidades (días)</th><th class="num">Días</th><th class="num">Facturado</th><th class="num">Material</th>
            <th class="num">Vehículo</th><th class="num">Nómina</th><th class="num">Descargos</th>
            <th class="num">Rentabilidad ${ayuda(AYUDA.rentabilidad21)}</th><th class="num">Variable ${ayuda(AYUDA.tramo21)}</th></tr></thead>
          <tbody>${filas.map(f => `<tr>
            <td><strong>${esc(f.nombre)}</strong> <span class="tenue">${esc(f.idTec)}</span></td>
            <td>${Object.entries(f.unidades || {}).map(([u, d]) => `${esc(nombreUnidad(u))} <span class="tenue">(${esc(num(d))})</span>`).join('<br>') || esc(nombreUnidad(f.unidad) || '—')}</td>
            <td class="num">${esc(num(f.diasTrabajados))}</td>
            <td class="num">${eur(f.ingresos)}</td><td class="num">${eur(f.material)}</td><td class="num">${eur(f.costeVeh)}</td>
            <td class="num">${eur(f.costeTec)}${marcaCoste(f.origenCostes)}</td>
            <td class="num">${eur(f.descargos)}</td>
            <td class="num"><strong>${eur(f.rentabilidad)}</strong></td>
            <td class="num"><strong>${eur(f.importe)}</strong></td>
          </tr>`).join('') || '<tr><td colspan="10" class="vacio">No hay técnicos en este mes.</td></tr>'}</tbody>
          ${filas.length ? `<tfoot><tr><td colspan="9">Variable de los técnicos</td><td class="num">${eur(suma(filas, 'importe'))}</td></tr></tfoot>` : ''}
        </table></div>
      </section>

      <section class="bloque">
        <h2>Por equipo</h2>
        <div class="tabla-scroll"><table class="tabla-liq">
          <thead><tr><th>Equipo</th><th class="num">Instalaciones</th><th class="num">Fallidas <span class="tenue">(no imputables)</span></th><th class="num">SAT</th>
            <th class="num">Programadas</th><th class="num">Días operados</th><th class="num">Facturado</th><th class="num">Material</th>
            <th class="num">Descargos</th><th class="num">Vehículo</th><th class="num">Combustible</th></tr></thead>
          <tbody>${equipos.map(e => `<tr>
            <td><strong>${esc(nombreUnidad(e.unidad))}</strong></td>
            <td class="num">${esc(num(e.obras))}</td>
            <td class="num">${esc(num(e.fallidas))} <span class="tenue">(${esc(num(e.fallidasNoImputables))})</span></td>
            <td class="num">${esc(num(e.sat))}</td><td class="num">${esc(num(e.programadas))}</td><td class="num">${esc(num(e.diasOperados))}</td>
            <td class="num">${eur(e.ingresos)}</td><td class="num">${eur(e.material)}</td><td class="num">${eur(e.descargos)}</td>
            <td class="num">${eur(e.costeVeh)}</td><td class="num">${eur(e.combustible)}</td>
          </tr>`).join('') || '<tr><td colspan="11" class="vacio">No hay equipos en este mes.</td></tr>'}</tbody>
        </table></div>
      </section>

      ${primas.length ? `<section class="bloque">
        <h2>Primas por incorporación</h2>
        <div class="tabla-scroll"><table>
          <thead><tr><th>Técnico incorporado</th><th>Formador</th><th class="num">Prima</th></tr></thead>
          <tbody>${primas.map(p => `<tr><td><strong>${esc(p.nombre)}</strong> <span class="tenue">${esc(p.idTec)}</span></td><td>${esc(p.formador || '—')}</td><td class="num">${eur(p.importe)}</td></tr>`).join('')}</tbody>
        </table></div>
        <p class="tenue">El total del variable del mes incluye 250 € por cada prima, que van a la Dirección de Operaciones.</p>
      </section>` : ''}

      ${incid.length ? `<details class="bloque tarjeta incidencias-fichaje"><summary><strong>Incidencias de fichaje</strong> <span class="insignia aviso">${incid.length}</span> <span class="tenue">· días trabajados sin fichaje</span></summary>
        <div class="tabla-scroll"><table>
          <thead><tr><th>Fecha</th><th>Técnico</th><th>Unidad</th><th>Tipo</th></tr></thead>
          <tbody>${incid.map(i => `<tr><td>${esc(fecha(i.fecha))}</td><td>${esc(i.tecnico)}</td><td>${esc(nombreUnidad(i.unidad) || '—')}</td><td>${esc(i.tipo)}</td></tr>`).join('')}</tbody>
        </table></div></details>` : ''}

      <p class="formula-tramo"><strong>Tramo:</strong> 0 € por debajo de 2.000 € de rentabilidad; 30 € + 0,045 × (R − 2.000) entre 2.000 y 3.000 €; 75 € por encima.
        · Informe mensual: <a href="https://drive.google.com/drive/search?q=${encodeURIComponent(informe)}" target="_blank" rel="noopener">${esc(informe)}</a> <span class="tenue">(Drive, «Informes Dirección»)</span></p>`;
  }

  function alCambiar(ev) {
    if (ev.target.id === 'mes' && ev.target.value) { mes = ev.target.value; recargar(); }
  }
  function alPulsar(ev) {
    if (ev.target.closest('[data-accion="recargar"]')) recargar();
  }
  el.addEventListener('change', alCambiar);
  el.addEventListener('click', alPulsar);
  recargar();

  return {
    recargar,
    desmontar() { el.removeEventListener('change', alCambiar); el.removeEventListener('click', alPulsar); },
  };
}
