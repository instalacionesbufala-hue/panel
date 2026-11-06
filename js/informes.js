// Pestaña «Informes» del dashboard (BACKEND.md, «Informes de la Dirección por semanas y meses», Supabase.gs v1.3).
// Abre el informe de la última semana publicada; «Por semanas» / «Por meses» cambia el histórico de la lista.
// Lee solo de Supabase (direccion:informes, direccion:semanal:*, direccion:mensual:*); mismo acceso para gerencia y Dirección.
import * as api from './api.js?v=41';
import { esc, cajaError } from './ui.js?v=41';
import { markdownAHtml } from './markdown.js?v=41';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// «2026-S45» → lunes y domingo de la semana ISO
function diasSemana(periodo) {
  const m = /^(\d{4})-S(\d{1,2})$/.exec(periodo || '');
  if (!m) return null;
  const ene4 = new Date(Date.UTC(+m[1], 0, 4));
  const lunes = new Date(ene4);
  lunes.setUTCDate(ene4.getUTCDate() - ((ene4.getUTCDay() + 6) % 7) + (+m[2] - 1) * 7);
  const domingo = new Date(lunes);
  domingo.setUTCDate(lunes.getUTCDate() + 6);
  return { semana: +m[2], lunes, domingo };
}
const dma = d => ({ d: d.getUTCDate(), m: d.getUTCMonth(), a: d.getUTCFullYear() });

// «Semana 45 · del 2 al 8 de noviembre de 2026»
function textoSemanaLargo(periodo) {
  const s = diasSemana(periodo);
  if (!s) return periodo;
  const l = dma(s.lunes), d = dma(s.domingo);
  const desde = l.a !== d.a ? `${l.d} de ${MESES[l.m]} de ${l.a}` : l.m !== d.m ? `${l.d} de ${MESES[l.m]}` : `${l.d}`;
  return `Semana ${s.semana} · del ${desde} al ${d.d} de ${MESES[d.m]} de ${d.a}`;
}
// «S45 · 2–8 nov 2026»
function textoSemanaCorto(periodo) {
  const s = diasSemana(periodo);
  if (!s) return periodo;
  const l = dma(s.lunes), d = dma(s.domingo), mc = i => MESES[i].slice(0, 3);
  const desde = l.m !== d.m ? `${l.d} ${mc(l.m)}` : `${l.d}`;
  return `S${s.semana} · ${desde}–${d.d} ${mc(d.m)} ${d.a}`;
}
// «2026-10» → «Octubre de 2026»
function textoMes(periodo) {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo || '');
  if (!m) return periodo;
  const nombre = MESES[+m[2] - 1] || m[2];
  return `${nombre[0].toUpperCase()}${nombre.slice(1)} de ${m[1]}`;
}
function publicado(iso) {
  const f = iso ? new Date(iso) : null;
  if (!f || Number.isNaN(f.getTime())) return '';
  return `Publicado el ${f.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })} a las ${f.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
}
function bajar(nombre, texto) {
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = nombre;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function crear(el) {
  let indice = null, error = null, modo = 'semanal', elegido = null, informe = null, errorInforme = null, cargando = true;
  let pedida = 0;   // la última petición manda: si se pulsa otra antes de que llegue, la anterior se descarta

  const lista = () => (modo === 'semanal' ? indice?.semanas : indice?.meses) || [];
  const textoLista = p => modo === 'semanal' ? textoSemanaCorto(p) : textoMes(p);

  function pintar() {
    if (error) { el.innerHTML = cajaError(error, 'No se han podido leer los informes'); return; }
    if (!indice) {
      el.innerHTML = cargando ? '<p class="cargando">Cargando…</p>'
        : '<div class="tarjeta bloque"><p class="tenue" style="margin:0">Los informes aún no están publicados en Supabase. Se publican cada día a las 07:30.</p></div>';
      return;
    }
    const periodos = lista();
    el.innerHTML = `
      <div class="informes">
        <aside class="tarjeta informes-lista">
          <div class="pestanas informes-modo" role="group" aria-label="Histórico">
            <button class="pestana" data-modo="semanal" aria-pressed="${modo === 'semanal'}" aria-selected="${modo === 'semanal'}">Por semanas</button>
            <button class="pestana" data-modo="mensual" aria-pressed="${modo === 'mensual'}" aria-selected="${modo === 'mensual'}">Por meses</button>
          </div>
          ${periodos.length ? `<ul>${periodos.map(p => `<li><button class="informes-elemento" data-periodo="${esc(p)}" ${p === elegido ? 'aria-current="true"' : ''}>${esc(textoLista(p))}</button></li>`).join('')}</ul>`
            : `<p class="tenue">Todavía no hay informes ${modo === 'semanal' ? 'semanales' : 'mensuales'} publicados.</p>`}
        </aside>
        <article class="tarjeta informes-visor" aria-live="polite">${visor()}</article>
      </div>`;
  }

  function visor() {
    if (!elegido) return '';
    if (cargando) return '<p class="cargando">Cargando…</p>';
    if (errorInforme) return cajaError(errorInforme, 'No se ha podido leer el informe');
    if (!informe) return `<p class="tenue">El informe de ${esc(modo === 'semanal' ? textoSemanaLargo(elegido) : textoMes(elegido))} no está publicado en Supabase.</p>`;
    return `
      <header class="informes-cabecera">
        <div>
          <h2>${esc(modo === 'semanal' ? textoSemanaLargo(elegido) : textoMes(elegido))}</h2>
          <p class="tenue">${esc(informe.nombre || '')}${informe.actualizado ? ' · ' + esc(publicado(informe.actualizado)) : ''}</p>
        </div>
        <span class="empuje"></span>
        <button class="boton secundario" data-accion="descargar-md">Descargar .md</button>
      </header>
      <div class="informe-texto">${markdownAHtml(informe.md)}</div>`;
  }

  async function abrir(periodo) {
    const yo = ++pedida;
    elegido = periodo; informe = null; errorInforme = null; cargando = true;
    pintar();
    if (!periodo) { cargando = false; pintar(); return; }
    try { const r = await api.leerInforme(modo, periodo); if (yo === pedida) informe = r; }
    catch (e) { if (yo === pedida) errorInforme = e; }
    if (yo !== pedida) return;
    cargando = false;
    pintar();
  }

  function alPulsar(ev) {
    const m = ev.target.closest('[data-modo]');
    if (m) { if (m.dataset.modo !== modo) { modo = m.dataset.modo; abrir(lista()[0]); } return; }
    const p = ev.target.closest('[data-periodo]');
    if (p) { if (p.dataset.periodo !== elegido || errorInforme) abrir(p.dataset.periodo); return; }
    if (ev.target.closest('[data-accion="descargar-md"]') && informe) {
      const nombre = informe.nombre || (modo === 'semanal' ? `BUFALA_Informe_Operaciones_${elegido}` : `BUFALA_Cierre_Mensual_${elegido}`);
      bajar(/\.md$/i.test(nombre) ? nombre : nombre + '.md', informe.md || '');
    }
  }

  el.addEventListener('click', alPulsar);
  pintar();
  (async () => {
    try { indice = await api.leerInformes(); } catch (e) { error = e; }
    cargando = false;
    if (indice) abrir(lista()[0]); else pintar();
  })();

  return { desmontar() { el.removeEventListener('click', alPulsar); pedida++; } };
}
