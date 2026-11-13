// Puente entre operaciones.html (el dashboard de siempre, en un iframe del panel) y la capa de datos del panel.
// Mismo origen que el panel: comparte su sesión de Supabase (localStorage) y lee dashboard:<mes>:<brigada> de `vistas`.
import * as api from './api.js?v=44';

// Sin sesión no se pide la contraseña aquí dentro: lo hace el panel
api.alPedirAcceso(() => Promise.reject(new api.ErrorApi('La sesión ha caducado: vuelve a entrar en el panel.', 'sesion')));

// Mes sin publicar: no es un fallo. operaciones.html pinta su caja de error al recibir el rechazo;
// justo después se cambia por un aviso neutro y se esconden las cifras del mes anterior.
function avisarSinDatos() {
  const caja = document.getElementById('errorArea');
  if (!caja) return;
  caja.innerHTML = '<div class="error-box" style="background:#F1F5F9; border-color:#CBD5E1; color:#334155">'
    + '<div class="err-title">Sin datos publicados para este mes</div></div>';
  const cifras = document.getElementById('dashContent');
  if (cifras) cifras.style.display = 'none';
}

window.panelDashboard = {
  leer: async (mes, brigada) => {
    try { return await api.leerDashboard(mes, brigada); }
    catch (e) {
      if (e && e.tipo === 'no-publicado') setTimeout(avisarSinDatos, 0);
      throw e;
    }
  },
};

document.getElementById('dashboardContainer').style.display = 'block';
window.initDashboard();
