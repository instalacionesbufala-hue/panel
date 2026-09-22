/**
 * PROPUESTA para el backend (Apps Script). No está desplegada: hay que acordarla y pegarla.
 * Cubre solo el ACCESO del panel y el enrutado seguro. Las acciones de datos
 * (panelConfig, panelCompras, …) dependen de la estructura de la hoja y están por hacer.
 *
 * 1) Propiedades del script (Configuración del proyecto → Propiedades del script):
 *      PANEL_SAL   = (se entrega aparte, junto con la contraseña)
 *      PANEL_HASH  = (se entrega aparte)
 *      PANEL_SESION_MIN = 360        (duración del testigo en minutos; CacheService no admite más de 360)
 *    La contraseña NO se guarda en ningún sitio: solo su huella SHA-256 con sal.
 *
 * 2) IMPORTANTE — primera línea de doPost(e) y de doGet(e):
 *      var rPanel = panelEnrutar_(e);
 *      if (rPanel) return rPanel;
 *    Hoy doPost trata cualquier POST como un cierre de obra y lo encola (COLA_*_SIN_ID.json).
 *    Sin este desvío, cada envío del panel crearía un cierre falso.
 *
 * 3) En la acción «ping» existente, añadir  panel: true  a la respuesta. El panel no envía
 *    ningún POST hasta ver esa marca.
 */

function panelEnrutar_(e) {
  var accion = (e && e.parameter && e.parameter.action) || '';
  if (accion.indexOf('panel') !== 0) return null;   // no es del panel: sigue el flujo de siempre
  var payload = {};
  try { payload = JSON.parse((e.parameter && e.parameter.payload) || '{}'); } catch (err) {
    return panelJson_({ ok: false, error: 'Petición mal formada.' });
  }
  if (accion === 'panelLogin') return panelJson_(panelLogin_(payload));

  var token = e.parameter.token || '';
  if (!panelTestigoValido_(token)) return panelJson_({ ok: false, codigo: 'sesion', error: 'La sesión ha caducado. Vuelve a entrar.' });

  // Aquí se conectan las acciones de datos cuando estén hechas, p. ej.:
  //   if (accion === 'panelConfig') return panelJson_(panelConfig_());
  return panelJson_({ ok: false, error: 'La acción «' + accion + '» aún no está implementada en el backend.' });
}

function panelLogin_(payload) {
  var props = PropertiesService.getScriptProperties();
  var sal = props.getProperty('PANEL_SAL'), hash = props.getProperty('PANEL_HASH');
  if (!sal || !hash) return { ok: false, error: 'El acceso al panel no está configurado en el servidor.' };

  // Freno a la fuerza bruta: 5 intentos fallidos bloquean 15 minutos
  var cache = CacheService.getScriptCache();
  var fallos = Number(cache.get('panel_fallos') || 0);
  if (fallos >= 5) return { ok: false, error: 'Demasiados intentos. Espera 15 minutos.' };

  var clave = String(payload.clave || '');
  if (panelHuella_(sal + clave) !== hash) {
    cache.put('panel_fallos', String(fallos + 1), 900);
    Utilities.sleep(800);
    return { ok: false, error: 'Contraseña incorrecta.' };
  }
  cache.remove('panel_fallos');

  var minutos = Math.min(Number(props.getProperty('PANEL_SESION_MIN') || 360), 360);
  var token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  cache.put('panel_t_' + token, '1', minutos * 60);
  return { ok: true, accion: 'panelLogin', token: token, caduca: new Date(Date.now() + minutos * 60000).toISOString() };
}

function panelTestigoValido_(token) {
  return !!token && CacheService.getScriptCache().get('panel_t_' + token) === '1';
}

function panelHuella_(texto) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8);
  return b.map(function (x) { return ('0' + (x & 0xff).toString(16)).slice(-2); }).join('');
}

function panelJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
