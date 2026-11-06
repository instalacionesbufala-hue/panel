// Puente entre operaciones.html (el dashboard de siempre, en un iframe del panel) y la capa de datos del panel.
// Mismo origen que el panel: comparte su sesión de Supabase (localStorage) y lee dashboard:<mes>:<brigada> de `vistas`.
import * as api from './api.js?v=41';

// Sin sesión no se pide la contraseña aquí dentro: lo hace el panel
api.alPedirAcceso(() => Promise.reject(new api.ErrorApi('La sesión ha caducado: vuelve a entrar en el panel.', 'sesion')));

window.panelDashboard = {
  leer: (mes, brigada) => api.leerDashboard(mes, brigada),
};

document.getElementById('dashboardContainer').style.display = 'block';
window.initDashboard();
