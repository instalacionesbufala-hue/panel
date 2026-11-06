// Dashboard en el panel (BACKEND.md, «Dashboard en el panel», Supabase.gs v1.2.1), con tres pestañas:
//  · «Operaciones»: el dashboard de siempre (operaciones.html en un iframe del mismo origen), leyendo de Supabase;
//  · «Dirección»: bloques configurables por cada usuario (js/tablero.js);
//  · «Informes»: informes semanales y mensuales de la Dirección (js/informes.js, Supabase.gs v1.3).
// El rol «direccion» ve «Dirección» e «Informes»; gerencia ve las tres y puede «Ver como Dirección».
import * as api from './api.js?v=41';
import * as tablero from './tablero.js?v=41';
import * as informes from './informes.js?v=41';

const CLAVE_PESTANA = 'bufala-panel-dashboard-pestana';   // solo comodidad: la última pestaña vista
const leerPestana = () => { try { return localStorage.getItem(CLAVE_PESTANA) || 'operaciones'; } catch { return 'operaciones'; } };
const recordarPestana = p => { try { localStorage.setItem(CLAVE_PESTANA, p); } catch { /* nada */ } };

export function montar(el) {
  let rol = null, pestana = leerPestana(), comoDireccion = false, control = null, controlInformes = null;

  const esDireccion = () => rol === 'direccion' || comoDireccion;

  function pintar() {
    if (esDireccion() && pestana === 'operaciones') pestana = 'direccion';
    el.innerHTML = `
      <div class="barra">
        <div><h1>Dashboard</h1><p class="tenue">${esDireccion() ? 'Indicadores e informes de la Dirección. Cada usuario elige sus bloques; los datos no se editan aquí.' : 'Operaciones: el dashboard de siempre. Dirección: bloques configurables. Informes: semanales y mensuales.'}</p></div>
        <span class="empuje"></span>
        <div class="pestanas" role="tablist" aria-label="Pestañas del dashboard">
          ${esDireccion() ? '' : `<button role="tab" class="pestana" aria-selected="${pestana === 'operaciones'}" data-pestana="operaciones">Operaciones</button>`}
          <button role="tab" class="pestana" aria-selected="${pestana === 'direccion'}" data-pestana="direccion">Dirección</button>
          <button role="tab" class="pestana" aria-selected="${pestana === 'informes'}" data-pestana="informes">Informes</button>
        </div>
        ${rol !== 'direccion' ? `<button class="boton secundario" data-accion="como-direccion">${comoDireccion ? 'Volver a la vista completa' : 'Ver como Dirección'}</button>` : ''}
      </div>
      ${comoDireccion ? '<p class="caja-aviso">Estás viendo el dashboard como lo ve la Dirección: las pestañas «Dirección» e «Informes».</p>' : ''}
      <section id="pestana-operaciones" ${pestana === 'operaciones' ? '' : 'hidden'}>
        ${esDireccion() ? '' : `<iframe class="marco-operaciones" title="Dashboard de Operaciones" src="operaciones.html?v=${encodeURIComponent(document.querySelector('script[src*="app.js"]')?.src.split('?v=')[1] || '')}"></iframe>`}
      </section>
      <section id="pestana-direccion" ${pestana === 'direccion' ? '' : 'hidden'}>
        <div id="tablero"></div>
      </section>
      <section id="pestana-informes" ${pestana === 'informes' ? '' : 'hidden'}></section>`;
    control?.desmontar?.();
    control = tablero.crear(el.querySelector('#tablero'));
    controlInformes?.desmontar();
    controlInformes = null;
    montarInformes();
  }
  // Los informes se leen la primera vez que se enseña su pestaña
  function montarInformes() {
    if (pestana === 'informes' && !controlInformes) controlInformes = informes.crear(el.querySelector('#pestana-informes'));
  }

  function alPulsar(ev) {
    const p = ev.target.closest('[data-pestana]');
    if (p) { pestana = p.dataset.pestana; recordarPestana(pestana); pintarPestanas(); return; }
    const b = ev.target.closest('[data-accion]');
    if (!b) return;
    if (b.dataset.accion === 'como-direccion') {
      comoDireccion = !comoDireccion;
      document.body.classList.toggle('como-direccion', comoDireccion);
      pestana = leerPestana();
      pintar();
    }
  }
  // Cambiar de pestaña no vuelve a pintar nada: el iframe y las gráficas se conservan
  function pintarPestanas() {
    el.querySelectorAll('[data-pestana]').forEach(x => x.setAttribute('aria-selected', String(x.dataset.pestana === pestana)));
    el.querySelector('#pestana-operaciones').hidden = pestana !== 'operaciones';
    el.querySelector('#pestana-direccion').hidden = pestana !== 'direccion';
    el.querySelector('#pestana-informes').hidden = pestana !== 'informes';
    montarInformes();
  }

  el.addEventListener('click', alPulsar);
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  (async () => {
    rol = await api.rolActual();
    pintar();
  })();

  return {
    pendiente: () => control?.pendiente?.() || false,
    recargar: () => control?.recargar?.(),
    desmontar() {
      el.removeEventListener('click', alPulsar);
      control?.desmontar?.();
      controlInformes?.desmontar();
      document.body.classList.remove('como-direccion');
    },
  };
}
