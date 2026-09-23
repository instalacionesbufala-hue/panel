# Panel de administración · Búfala Tech

Interfaz web para configurar la operación: técnicos, vehículos, unidades, combustible, costes de personal y liquidación mensual. Son ficheros estáticos (HTML, CSS y JavaScript nativo), sin compilación y sin dependencias. Toda la información vive en el backend de Apps Script; el panel no guarda datos propios.

> **Estado (23/09/2026): modo demostración.** El backend (v3.20.12) solo tiene el acceso (`panelLogin`). **Todo lo demás se sirve con datos de ejemplo** definidos en `js/api.js`, con la forma exacta del contrato. Esos datos viven solo en memoria: se pierden al recargar y no se envían a ningún sitio. Una franja amarilla lo recuerda en todas las pantallas.

## Qué va a producción: lo decide el backend

Al cargar la página, el panel pregunta `GET ?action=ping`. El backend responde `{ panel: true, accionesPanel: [...] }`:

- Las acciones que figuren en `accionesPanel` van a producción.
- El resto se sirve en modo demostración.
- El acceso nunca se simula: si `panelLogin` no figura en la lista, no se puede entrar.
- Si el `ping` no responde, el panel avisa de que no hay conexión y vuelve a preguntar al intentar entrar.

**No hay que tocar el código del panel** cuando el backend añade una acción: basta con recargar la página. La franja amarilla indica qué acciones van ya al sistema de gestión y desaparece cuando van todas. En las escrituras, el panel exige que la respuesta repita la acción (`"accion": "…"`); si no la repite, no da nada por guardado.

Conviene que el backend active juntas las acciones que se leen y escriben sobre lo mismo (por ejemplo `panelConfig` y `panelGuardarConfig`). Si no, una pantalla podría leer datos reales y guardar en la demostración.

## Estructura

```
index.html            entrada, navegación y pantalla de acceso
css/panel.css
js/api.js             ÚNICA capa que habla con el backend: URL, lista de acciones (vía ping) y datos de demostración
js/app.js             navegación, acceso y aviso de conexión
js/ui.js              utilidades de interfaz (formatos, diálogos, avisos)
js/unidades.js        formar unidades arrastrando y soltando
js/combustible.js     asignar facturas de combustible a vehículos
js/costes.js          volcar los costes de la gestoría
js/tecnicos.js        altas, bajas y edición de técnicos, vehículos y unidades
js/liquidacion.js     liquidación mensual (solo lectura)
DECISIONES.md         decisiones tomadas y lo que queda pendiente en el contrato
```

## Configurar la URL del backend

Está en un único sitio, la primera constante de `js/api.js`:

```js
export const URL_BACKEND = 'https://script.google.com/macros/s/…/exec';
```

Ahora mismo apunta a la implementación activa. Si se publica una implementación nueva con otra URL, se cambia ahí y en ningún sitio más.

## Publicar en GitHub Pages

1. Crea un repositorio (puede ser privado con GitHub Pro; si es público, el código es visible, pero no contiene datos ni contraseñas).
2. Sube el contenido de esta carpeta a la raíz del repositorio.
3. En *Settings → Pages*, elige *Deploy from a branch*, rama `main`, carpeta `/ (root)`.
4. En uno o dos minutos estará en `https://<usuario>.github.io/<repositorio>/`.

La página lleva `noindex` para que los buscadores no la indexen. Aun así, la protección real es la contraseña, que valida el backend.

**Al cambiar un fichero**, sube el número `?v=` de `index.html`. Los módulos que importa `app.js` no llevan número: GitHub Pages los guarda en caché unos 10 minutos, así que tras publicar puede hacer falta esperar o forzar la recarga (Ctrl+F5).

## Probar en local

Los módulos de JavaScript no se cargan abriendo `index.html` con doble clic (`file://`): los navegadores lo bloquean. Hace falta un servidor estático cualquiera, por ejemplo:

```
npx serve .
```

o `python -m http.server 8080` en esta carpeta, y abrir `http://localhost:8080/`. En GitHub Pages funciona tal cual.

## Acceso

La contraseña la valida el backend: `POST` con el cuerpo `payload={"accion":"panelLogin","clave":"…"}`, que responde `{ ok, token, caduca }` o `{ ok:false, error }`. Tras 5 fallos responde `bloqueado:true` durante 15 minutos, y el panel muestra el aviso. El testigo se guarda en `sessionStorage` hasta su caducidad (y se borra al cerrar la pestaña). La contraseña no se guarda ni en el código ni en el navegador.

Si el testigo caduca en mitad del trabajo, se pide la contraseña encima de la pantalla y la operación se repite al entrar: no se pierde lo que estuviera escrito.
