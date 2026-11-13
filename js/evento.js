// «Nuevo evento» (BACKEND.md, «panelAltaEvento»; issue #12): alta en el calendario de los eventos que no vienen
// de ESBRAIN ni de InstantBox. Solo gerencia: la Dirección no la ve en el menú y aquí tampoco se pinta.
// Paso 1 «Vista previa» (modo simular): lo que el backend lee del presupuesto u obra. Paso 2 «Crear evento» (modo crear),
// siempre con los mismos datos de la vista previa: cualquier cambio en el formulario la descarta.
// Spec 004: si la vista previa anuncia `admite`, se pueden corregir los datos leídos (`correcciones`) y escribir
// «Notas para el técnico» (`notas`, solo van al evento). Sin ese anuncio, la vista previa es de solo lectura:
// nunca se envía algo que el servidor pueda ignorar sin decirlo.
import * as api from './api.js?v=44';
import { esc, hoy } from './ui.js?v=44';

const TIPOS = { directo: 'Instalación de cliente directo', intervencion: 'Intervención o incidencia' };
// Lo que se enseña de la vista previa, en este orden (solo lo que venga)
const CAMPOS = [
  ['titulo', 'Título'], ['numInst', 'Nº de instalación'], ['cliente', 'Cliente'], ['direccion', 'Dirección'], ['telefono', 'Teléfono'],
  ['hardware', 'Hardware a instalar'], ['potencia', 'Potencia contratada'], ['metros', 'Metros'], ['seccion', 'Sección'],
  ['obraOriginal', 'Obra original'], ['partner', 'Partner'], ['calendario', 'Calendario'], ['fecha', 'Fecha'], ['desde', 'Desde'], ['hasta', 'Hasta'],
];
// Los que se pueden corregir (con `admite: ["correcciones"]`): [clave, etiqueta, tipo de campo, ayuda]
const CORREGIBLES = [
  ['cliente', 'Cliente', 'text'], ['direccion', 'Dirección', 'text'], ['telefono', 'Teléfono', 'tel'],
  ['hardware', 'Hardware a instalar', 'area'], ['potencia', 'Potencia contratada', 'text', 'p. ej. 5,5 kW'],
  ['metros', 'Metros', 'number'], ['seccion', 'Sección (mm²)', 'text'],
];
const ES_CORREGIBLE = new Set(CORREGIBLES.map(([k]) => k));
const NOMBRE = Object.fromEntries([...CAMPOS, ['notas', 'Notas para el técnico']]);
const MAX_NOTAS = 1000;

const fechaEs = iso => /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('/') : iso;
const valor = (k, v) => k === 'fecha' ? fechaEs(v) : k === 'calendario' && v === 'principal' ? 'Principal (el técnico elige equipo en el wizard)' : k === 'metros' && v !== '' && v != null ? `${v} m` : v;
// Las direcciones https:// del texto del backend, como enlaces (el resto, escapado)
const conEnlaces = t => esc(t).replace(/https:\/\/[^\s<>"']+/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
const enlace = (url, texto) => /^https:\/\//.test(url || '') ? `<a class="boton secundario" href="${esc(url)}" target="_blank" rel="noopener">${esc(texto)}</a>` : '';
const texto = v => v === undefined || v === null ? '' : String(v).trim();

export function montar(el) {
  let tipo = 'directo', equipos = [], enProduccion = false;
  // La vista previa vigente: lo que se envió (cuerpo), lo que respondió (r), lo corregido (valor escrito por campo) y las notas
  let previa = null;
  let creado = null;      // { r, noConfirma: [nombres] }: respuesta de «crear»
  let error = null, esperando = null, reloj = null, vivo = true;

  function formulario() {
    return `
      <form id="form-evento" class="tarjeta bloque evento-form" novalidate>
        <label>Tipo
          <select id="ev-tipo">${Object.entries(TIPOS).map(([k, t]) => `<option value="${k}" ${k === tipo ? 'selected' : ''}>${t}</option>`).join('')}</select>
        </label>
        ${tipo === 'directo'
          ? `<label>Nº de presupuesto de Holded<input id="ev-numero" required autocomplete="off" spellcheck="false" placeholder="E261158"></label>`
          : `<label>Nº de la obra original<input id="ev-numero" required autocomplete="off" spellcheck="false" placeholder="E…, IB-… o D-…"></label>
             <label class="evento-ancho">Qué hay que revisar<textarea id="ev-motivo" required rows="3"></textarea></label>`}
        <div class="evento-fila">
          <label>Fecha<input type="date" id="ev-fecha" required value="${hoy()}"></label>
          <label>Desde<input type="time" id="ev-desde" required step="900"></label>
          <label>Hasta<input type="time" id="ev-hasta" required step="900"></label>
        </div>
        <label>Equipo (opcional)
          <select id="ev-equipo"><option value="">Sin equipo (calendario principal)</option>${equipos.map(e => `<option>${esc(e)}</option>`).join('')}</select>
        </label>
        <p id="ev-error" class="error" hidden></p>
        <div class="evento-botones"><button class="boton" type="submit" id="ev-previa">Vista previa</button></div>
      </form>`;
  }

  function pintarInicial() {
    el.innerHTML = `
      <div class="barra"><div><h1>Nuevo evento</h1>
        <p class="tenue">Alta en el calendario de las instalaciones de cliente directo y de las intervenciones, con el formato de siempre y su enlace del wizard.</p></div></div>
      ${enProduccion ? '' : '<p class="caja-aviso">Modo demostración: el servidor aún no admite esta pantalla. Los datos son de ejemplo y no se crea nada en el calendario.</p>'}
      ${formulario()}
      <div id="ev-resultado"><div id="ev-previa-caja"></div><div id="ev-estado"></div></div>`;
  }

  const admite = () => new Set(previa?.r?.admite || []);
  const leido = k => texto(previa.r.datos?.[k]);
  const actual = k => k in previa.corregido ? previa.corregido[k] : leido(k);
  const estaCorregido = k => k in previa.corregido && texto(previa.corregido[k]) !== leido(k);
  const hayEscrito = () => !!previa && (CORREGIBLES.some(([k]) => estaCorregido(k)) || !!texto(previa.notas));

  function campoCorregible([k, etiqueta, clase, ayuda]) {
    const v = actual(k), cambiado = estaCorregido(k);
    const comun = `data-campo="${k}" id="ev-c-${k}" ${ayuda ? `placeholder="${esc(ayuda)}"` : ''}`;
    const entrada = clase === 'area' ? `<textarea ${comun} rows="2">${esc(v)}</textarea>`
      : clase === 'number' ? `<input type="number" min="0" step="1" inputmode="numeric" ${comun} value="${esc(v)}">`
      : `<input type="${clase}" ${comun} value="${esc(v)}" autocomplete="off">`;
    return `<div class="evento-campo${cambiado ? ' corregido' : ''}${clase === 'area' ? ' evento-ancho' : ''}" data-envoltorio="${k}">
      <label for="ev-c-${k}">${esc(etiqueta)} <span class="evento-marca">corregido</span></label>
      ${entrada}
      <button type="button" class="evento-revertir" data-accion="revertir" data-campo="${k}" title="Volver a lo leído: ${esc(leido(k) || '(vacío)')}">↺ Volver a lo leído</button>
    </div>`;
  }

  function htmlPrevia() {
    if (!previa) return '';
    const d = previa.r.datos || {}, avisos = previa.r.avisos || [], a = admite();
    const corrige = a.has('correcciones'), notas = a.has('notas');
    const fijos = CAMPOS.filter(([k]) => !(corrige && ES_CORREGIBLE.has(k)) && d[k] !== undefined && d[k] !== null && d[k] !== '');
    return `<div class="tarjeta bloque evento-previa">
      <h2>Vista previa · ${esc(TIPOS[previa.cuerpo.tipo])}</h2>
      ${corrige ? `<p class="tenue">Puedes corregir lo leído: va al evento y al wizard. Holded no se toca.</p>
        <div class="evento-corregibles">${CORREGIBLES.map(campoCorregible).join('')}</div>` : ''}
      <table class="evento-datos"><tbody>${fijos.map(([k, t]) => `<tr><th>${t}</th><td>${esc(valor(k, d[k]))}</td></tr>`).join('')}</tbody></table>
      ${notas ? `<label class="evento-notas">Notas para el técnico <span class="tenue">(solo en el evento del calendario, destacadas)</span>
          <textarea id="ev-notas" rows="3" maxlength="${MAX_NOTAS}" placeholder="p. ej. Usar manguera de 10 mm²">${esc(previa.notas)}</textarea>
          <span class="tenue evento-contador" id="ev-contador">${previa.notas.length}/${MAX_NOTAS}</span></label>` : ''}
      ${!corrige || !notas ? `<p class="caja-aviso">${!corrige && !notas ? 'Las notas para el técnico y las correcciones'
        : !corrige ? 'Las correcciones' : 'Las notas para el técnico'} llegarán cuando el servidor las active. Por ahora el evento se crea con lo leído.</p>` : ''}
      ${avisos.length ? `<ul class="caja-aviso evento-avisos">${avisos.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <p id="ev-error-previa" class="error" hidden></p>
      ${error?.sinConfirmar ? '' /* sin repetir a ciegas: primero se mira el calendario */ : `<div class="evento-botones"><button class="boton" type="button" data-accion="crear">Crear evento</button>
        <span class="tenue">Se crea con estos datos. Si cambias algo del formulario de arriba, vuelve a pedir la vista previa.</span></div>`}
    </div>`;
  }

  function htmlCreado() {
    const r = creado.r, ev = r.evento || {};
    return `<div class="tarjeta bloque evento-hecho" role="status">
      <h2>${r.simulacion ? 'Demostración: no se ha creado nada en el calendario' : 'Evento creado'}</h2>
      <p>${esc(r.datos?.titulo || '')}${r.datos?.fecha ? ` · ${esc(fechaEs(r.datos.fecha))} de ${esc(r.datos.desde || '')} a ${esc(r.datos.hasta || '')}` : ''}</p>
      ${creado.noConfirma.length ? `<p class="caja-aviso" role="alert">El servidor no confirma ${esc(creado.noConfirma.join(', '))}: revisa el evento en el calendario.</p>` : ''}
      <div class="evento-botones">${enlace(ev.enlace, 'Abrir el evento')}${enlace(ev.wizard, 'Abrir el wizard')}
        <button class="boton" type="button" data-accion="otro">Dar de alta otro</button></div>
      ${!ev.enlace && !r.simulacion ? '<p class="tenue">El servidor no ha devuelto el enlace del evento.</p>' : ''}
    </div>`;
  }

  function htmlEstado() {
    if (esperando) return `<div class="tarjeta bloque evento-espera" role="status"><span class="cargando evento-reloj">${esperando.texto}</span>… suele tardar entre 5 y 35 s · lleva <strong>${Math.round((Date.now() - esperando.desde) / 1000)} s</strong></div>`;
    if (error) return `<div class="caja-error" role="alert"><strong>${esc(error.sinConfirmar ? 'Sin confirmar' : error.tipo === 'red' ? 'Sin conexión' : error.tipo === 'permiso' ? 'Sin permiso' : 'No se ha podido')}.</strong>
        ${error.sinConfirmar ? 'Puede que el evento se haya creado: revisa el calendario antes de repetirlo (el sistema no duplica un evento de la misma obra el mismo día).' : conEnlaces(error.message || error)}
        ${error.enlace ? `<p style="margin:.6rem 0 0">${enlace(error.enlace, 'Abrir el evento existente')}</p>` : ''}</div>`;
    return '';
  }

  // La vista previa (con lo escrito) se conserva en pantalla durante la espera y tras un error de «crear»
  function pintarResultado() {
    const caja = el.querySelector('#ev-previa-caja');
    if (!caja) return;
    caja.innerHTML = creado ? htmlCreado() : htmlPrevia();
    pintarEstado();
  }
  function pintarEstado() {
    const estado = el.querySelector('#ev-estado');
    if (estado) estado.innerHTML = creado ? '' : htmlEstado();
  }

  function bloquear(si) {
    el.querySelectorAll('#form-evento input, #form-evento select, #form-evento textarea, #form-evento button, #ev-resultado input, #ev-resultado textarea, #ev-resultado button')
      .forEach(x => { x.disabled = si; });
  }

  // Una petición cada vez, con su aviso de espera
  async function pedir(cuerpo, modo) {
    error = null;
    esperando = { texto: modo === 'crear' ? 'Creando el evento' : 'Leyendo los datos', desde: Date.now() };
    pintarEstado(); bloquear(true);
    reloj = setInterval(pintarEstado, 1000);
    try { return await api.altaEvento(cuerpo, modo); }
    catch (e) { error = e; return null; }
    finally {
      clearInterval(reloj); esperando = null;
      if (vivo) { bloquear(false); if (error?.sinConfirmar) pintarResultado(); else pintarEstado(); }
    }
  }

  function leerFormulario() {
    const $ = s => el.querySelector(s);
    const cuerpo = {
      tipo,
      fecha: $('#ev-fecha').value, desde: $('#ev-desde').value, hasta: $('#ev-hasta').value,
      equipo: $('#ev-equipo').value,
    };
    const numero = $('#ev-numero').value.replace(/\s+/g, '').toUpperCase();
    $('#ev-numero').value = numero;
    if (tipo === 'directo') cuerpo.presupuesto = numero; else { cuerpo.obra = numero; cuerpo.motivo = $('#ev-motivo').value.trim(); }
    const falta = !numero ? (tipo === 'directo' ? 'Escribe el nº de presupuesto de Holded.' : 'Escribe el nº de la obra original.')
      : tipo === 'intervencion' && !cuerpo.motivo ? 'Escribe qué hay que revisar.'
      : !cuerpo.fecha ? 'Elige la fecha.' : !cuerpo.desde || !cuerpo.hasta ? 'Pon la hora de inicio y la de fin.'
      : cuerpo.hasta <= cuerpo.desde ? '«Hasta» tiene que ser posterior a «Desde».' : '';
    return { cuerpo, falta };
  }

  // Lo que se envía al crear: el cuerpo de la vista previa + lo corregido (solo lo que cambia) + las notas
  function cuerpoCrear() {
    const a = admite(), cuerpo = { ...previa.cuerpo }, correcciones = {};
    if (a.has('correcciones')) {
      for (const [k] of CORREGIBLES) {
        if (!estaCorregido(k)) continue;
        const v = texto(previa.corregido[k]);
        if ((k === 'cliente' || k === 'direccion') && !v) return { falta: `${NOMBRE[k]} no puede quedar vacío.` };
        if (k === 'metros') {
          const n = Number(v.replace(',', '.'));
          if (v === '' || !Number.isFinite(n) || n < 0) return { falta: 'Los metros tienen que ser un número (0 o más).' };
          correcciones.metros = n;
        } else correcciones[k] = v;
      }
      if (Object.keys(correcciones).length) cuerpo.correcciones = correcciones;
    }
    const notas = texto(previa.notas);
    if (a.has('notas') && notas) cuerpo.notas = notas;
    return { cuerpo };
  }

  // Lo que el servidor dice haber creado tiene que llevar lo corregido y las notas
  function sinConfirmar(enviado, r) {
    const d = r.datos || {}, faltan = [];
    for (const [k, v] of Object.entries(enviado.correcciones || {}))
      if (k === 'metros' ? Number(d.metros) !== v : texto(d[k]) !== v) faltan.push(NOMBRE[k].toLowerCase());
    if (enviado.notas && texto(d.notas) !== enviado.notas) faltan.push('las notas para el técnico');
    return faltan;
  }

  async function alEnviar(ev) {
    ev.preventDefault();
    if (esperando) return;
    const { cuerpo, falta } = leerFormulario();
    const err = el.querySelector('#ev-error');
    err.hidden = !falta; err.textContent = falta;
    if (falta) return;
    previa = null; creado = null; pintarResultado();
    const r = await pedir(cuerpo, 'simular');
    if (r && vivo) { previa = { cuerpo, r, corregido: {}, notas: '' }; pintarResultado(); }
  }

  async function alPulsar(ev) {
    const b = ev.target.closest('[data-accion]');
    if (!b || esperando) return;
    if (b.dataset.accion === 'crear' && previa) {
      const { cuerpo, falta } = cuerpoCrear();
      const aviso = el.querySelector('#ev-error-previa');
      if (aviso) { aviso.hidden = !falta; aviso.textContent = falta || ''; }
      if (falta) return;
      const r = await pedir(cuerpo, 'crear');
      if (r && vivo) { creado = { r, noConfirma: sinConfirmar(cuerpo, r) }; previa = null; pintarResultado(); }
    }
    if (b.dataset.accion === 'revertir' && previa) {
      delete previa.corregido[b.dataset.campo];
      const caja = el.querySelector(`[data-envoltorio="${b.dataset.campo}"]`);
      if (caja) caja.outerHTML = campoCorregible(CORREGIBLES.find(([k]) => k === b.dataset.campo));
    }
    if (b.dataset.accion === 'otro') {
      creado = null; previa = null; error = null;
      pintarInicial();
    }
  }

  // Lo que se escribe en la vista previa (correcciones y notas) se guarda sin repintar, para no perder el foco
  function alEscribirEnPrevia(t) {
    if (t.id === 'ev-notas') {
      previa.notas = t.value;
      const c = el.querySelector('#ev-contador');
      if (c) c.textContent = `${t.value.length}/${MAX_NOTAS}`;
      return;
    }
    const k = t.dataset.campo;
    if (!k) return;
    previa.corregido[k] = t.value;
    el.querySelector(`[data-envoltorio="${k}"]`)?.classList.toggle('corregido', estaCorregido(k));
  }

  // Si no se confirma el descarte, el formulario vuelve a lo que se envió en la vista previa
  function restaurarFormulario() {
    const c = previa.cuerpo, poner = (s, v) => { const x = el.querySelector(s); if (x) x.value = v ?? ''; };
    poner('#ev-tipo', c.tipo); poner('#ev-numero', c.tipo === 'directo' ? c.presupuesto : c.obra); poner('#ev-motivo', c.motivo);
    poner('#ev-fecha', c.fecha); poner('#ev-desde', c.desde); poner('#ev-hasta', c.hasta); poner('#ev-equipo', c.equipo);
  }

  // Cualquier cambio del formulario descarta la vista previa (y el error anterior); si hay algo escrito, se pregunta
  function alCambiar(ev) {
    const t = ev.target;
    if (previa && t.closest('#ev-previa-caja')) { if (ev.type === 'input') alEscribirEnPrevia(t); return; }
    if (!t.closest('#form-evento')) return;
    // Un solo aviso por cambio: los desplegables por «change», el resto por «input»
    if ((ev.type === 'change') !== (t.tagName === 'SELECT')) return;
    if (hayEscrito()) {
      if (!confirm('Se descartarán las correcciones y las notas de la vista previa. ¿Seguir?')) {
        restaurarFormulario();
        return;
      }
    }
    if (t.id === 'ev-tipo' && ev.type === 'change') {
      tipo = t.value;
      const f = el.querySelector('#form-evento');
      const guardar = ['#ev-fecha', '#ev-desde', '#ev-hasta', '#ev-equipo'].map(s => [s, el.querySelector(s).value]);
      f.outerHTML = formulario();
      guardar.forEach(([s, v]) => { el.querySelector(s).value = v; });
    }
    if (previa || error || creado) { previa = null; error = null; creado = null; pintarResultado(); }
  }

  el.addEventListener('submit', alEnviar);
  el.addEventListener('click', alPulsar);
  el.addEventListener('input', alCambiar);
  el.addEventListener('change', alCambiar);
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  (async () => {
    if ((await api.rolActual()) === 'direccion') {   // solo gerencia (además del menú y del servidor)
      if (vivo) location.hash = '#dashboard';
      return;
    }
    enProduccion = (await api.accionesEnProduccion().catch(() => new Set())).has('panelAltaEvento');
    try {
      const c = await api.leerConfig();
      equipos = (c.unidades || []).filter(u => u.activa !== false && u.equipo).map(u => u.id).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
    } catch { /* sin lista: solo «Sin equipo (calendario principal)» */ }
    if (vivo) pintarInicial();
  })();

  return {
    // Con una vista previa a medio crear no hay nada que perder: no se pregunta al salir
    desmontar() {
      vivo = false;
      clearInterval(reloj);
      el.removeEventListener('submit', alEnviar);
      el.removeEventListener('click', alPulsar);
      el.removeEventListener('input', alCambiar);
      el.removeEventListener('change', alCambiar);
    },
  };
}
