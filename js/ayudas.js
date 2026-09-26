// Iconos de ayuda «i» (BACKEND.md, encargo 7): una o dos líneas, sin jerga, con qué mide cada cosa y cómo se calcula.
// La ventana flotante es una sola, con posición fija sobre la ventana: así no la recortan los contenedores con scroll.
import { esc } from './ui.js?v=25';

// Textos. Los marcados como obligatorios vienen tal cual del encargo del backend.
export const AYUDA = {
  // Obligatorios
  rendimiento: 'Servicios equivalentes ÷ capacidad. Instalación = 1, 2 desde 70 m, 3 desde 120 m (máx. 3); fallida = 1. Capacidad de cada día = mín(servicios/día de la unidad, técnicos presentes).',
  aprovechamiento: 'Tiempo instalando ÷ jornada fichada en Holded (sin fichaje, la teórica de la unidad). El resto es abastecimiento y desplazamientos.',
  tiempoMedio: 'Del check-in en ESBRAIN al «Finalizar». InstantBox: estimado (envío del cierre − inicio − desplazamiento según km, mín. 30 min). No computan las anómalas (> 2× mediana) ni las incidencias de ESBRAIN.',
  regimen: 'Servicios al día y jornada de la unidad desde una fecha; sin régimen, 2 servicios y 7 h 42 min.',
  ausencias: 'Se registran en Holded y se copian cada mañana; las de SAT y Gerencia no restan capacidad.',
  precios: 'Coste por unidad con el que se recalcula el material de cada instalación (col AJ del Registro).',
  datoManual: 'Este dato no lo registra el sistema.',
  // Panel
  plantilla: 'Técnicos con unidad el día elegido, de todos los que están de alta ese día.',
  brigadasCompletas: 'Brigadas con el máximo de técnicos que admite el servidor.',
  cambiosSinGuardar: 'Movimientos hechos en esta pantalla que aún no se han enviado. Valen desde la fecha elegida.',
  vehiculosEnUso: 'Vehículos asignados a alguna unidad el día elegido, de todos los que están en servicio.',
  noProductivas: 'SAT y Estructura: sin límite de técnicos y fuera del cálculo del variable.',
  resumenVehiculo: 'Suma sin IVA de lo asignado a cada matrícula este mes: combustible, renting y mantenimiento.',
  pendientes: 'Facturas de combustible o vehículo sin matrícula ni Estructura, y facturas sin clasificar, desde mayo de 2026.',
  materialHerramienta: 'Compras que se pueden cargar a equipos, a partes iguales en el mes de la factura. Sin equipos: la herramienta va a Estructura y el material no suma.',
  sinClasificar: 'Facturas cuyo proveedor aún no tiene tipo. Ábrelas para verlas y clasificarlas una a una o todas las del proveedor.',
  costeEmpresa: 'Bruto + Seguridad Social a cargo de la empresa + prorrata de pagas, según la nómina de la gestoría.',
  diasLaborables: 'De lunes a viernes, sin festivos. Lo calcula el servidor.',
  vacacionesQuedan: '22 días de vacaciones al año según convenio, menos los ya disfrutados.',
  festivos: 'Días no laborables del calendario de Holded. Entre semana restan capacidad y días laborables; en fin de semana no.',
  costeUnidad: 'Precio de coste por unidad, sin IVA. Al guardarlo se recalcula el material de todas las instalaciones.',
  rol: 'Función en la empresa (Instalador, Jefe, SAT, Gerencia). No limita a qué unidad puede ir.',
  grupo: 'Grupo profesional del convenio. Puede faltar en quien está fuera de convenio.',
  brigadaHoy: 'Unidad a la que está asignado hoy según la hoja de recursos.',
  obras: 'Instalaciones cerradas por el técnico en el mes.',
  margen: 'Ingresos − material − coste técnico − coste vehículo.',
  tramo: 'Escala del variable en la que cae el margen del técnico.',
  variable: 'Lo calcula el servidor con el tramo del margen. El panel no lo recalcula.',
};

export const ayuda = texto => texto
  ? `<span class="ayuda" tabindex="0" role="button" aria-label="Ayuda" data-ayuda="${esc(texto)}">i</span>`
  : '';

let burbuja = null, actual = null, fijada = false;

function mostrar(el) {
  if (!burbuja) {
    burbuja = document.createElement('div');
    burbuja.id = 'burbuja-ayuda';
    burbuja.className = 'burbuja-ayuda';
    burbuja.setAttribute('role', 'tooltip');
  }
  // Dentro de un diálogo modal hay que estar en su misma capa, o la tapa
  const capa = el.closest('dialog[open]') || document.body;
  if (burbuja.parentNode !== capa) capa.append(burbuja);
  burbuja.textContent = el.dataset.ayuda;
  burbuja.hidden = false;
  actual?.removeAttribute('aria-describedby');
  actual = el;
  el.setAttribute('aria-describedby', 'burbuja-ayuda');

  const r = el.getBoundingClientRect(), b = burbuja.getBoundingClientRect();
  const centro = r.left + r.width / 2;
  const izq = Math.max(8, Math.min(centro - b.width / 2, window.innerWidth - b.width - 8));
  let arriba = r.bottom + 10, invertida = false;
  if (arriba + b.height > window.innerHeight - 8 && r.top - b.height - 10 > 8) { arriba = r.top - b.height - 10; invertida = true; }
  burbuja.style.left = `${izq}px`;
  burbuja.style.top = `${arriba}px`;
  burbuja.style.setProperty('--flecha', `${centro - izq}px`);
  burbuja.classList.toggle('invertida', invertida);
}
function ocultar() {
  if (burbuja) burbuja.hidden = true;
  actual?.removeAttribute('aria-describedby');
  actual = null; fijada = false;
}

// Se activa una vez por página (panel y direccion.html)
let activas = false;
export function activarAyudas() {
  if (activas) return;
  activas = true;
  const icono = ev => ev.target.closest?.('.ayuda');
  document.addEventListener('mouseover', ev => { const i = icono(ev); if (i && !fijada) mostrar(i); });
  document.addEventListener('mouseout', ev => { const i = icono(ev); if (i && !fijada && !i.contains(ev.relatedTarget)) ocultar(); });
  document.addEventListener('focusin', ev => { const i = icono(ev); if (i) mostrar(i); });
  document.addEventListener('focusout', ev => { if (icono(ev)) ocultar(); });
  // Al tocar (móvil) o pulsar, se queda fija hasta tocar fuera; no dispara lo que haya debajo
  document.addEventListener('click', ev => {
    const i = icono(ev);
    if (!i) { if (fijada) ocultar(); return; }
    ev.preventDefault(); ev.stopPropagation();
    if (fijada && actual === i) { ocultar(); return; }
    mostrar(i); fijada = true;
  }, true);
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && actual) { ocultar(); return; }
    const i = icono(ev);
    if (i && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); mostrar(i); fijada = true; }
  });
  // Al desplazar (también el que provoca el foco con el teclado) la ventana acompaña al icono
  window.addEventListener('scroll', () => { if (actual) { if (actual.isConnected) mostrar(actual); else ocultar(); } }, true);
  window.addEventListener('resize', () => { if (actual) ocultar(); });
}
