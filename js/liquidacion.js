// Liquidación mensual: solo lectura. El cálculo lo hace el backend; aquí solo se muestra.
import * as api from './api.js?v=12';
import { esc, eur, mesActual, nombreMes, cajaError, selectorMes } from './ui.js?v=12';

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
          <th>Técnico</th><th>Unidad</th><th class="num">Obras</th><th class="num">Ingresos</th><th class="num">Material</th>
          <th class="num">Coste técnico</th><th class="num">Coste vehículo</th><th class="num">Margen</th><th>Tramo</th><th class="num">Variable</th>
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
