# Panel de administración · Búfala Tech

Interfaz web para configurar la operación: técnicos, vehículos, unidades, combustible, costes de personal y liquidación mensual. Son ficheros estáticos (HTML, CSS y JavaScript nativo), sin compilación y sin dependencias. Toda la información vive en el backend de Apps Script; el panel no guarda datos propios.

> **Estado (22/09/2026):** el panel está terminado y probado contra un simulador del contrato. El backend activo (v3.20.7) **aún no tiene las acciones `panel*`**. Hasta que las tenga, el panel se niega a enviar nada (ver «Salvaguarda» en `DECISIONES.md`).

## Estructura

```
index.html            entrada, navegación y pantalla de acceso
css/panel.css
js/api.js             ÚNICA capa que habla con el backend (aquí va la URL)
js/app.js             navegación, acceso y aviso de conexión
js/ui.js              utilidades de interfaz (formatos, diálogos, avisos)
js/unidades.js        formar unidades arrastrando y soltando
js/combustible.js     asignar facturas de combustible a vehículos
js/costes.js          volcar los costes de la gestoría
js/tecnicos.js        altas, bajas y edición de técnicos, vehículos y unidades
js/liquidacion.js     liquidación mensual (solo lectura)
backend-propuesta/    propuesta de código de acceso para Apps Script (no desplegada)
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

**Al cambiar un fichero**, sube el número `?v=` de `index.html` para que el navegador no se quede con la versión anterior.

## Probar en local

Los módulos de JavaScript no se cargan abriendo `index.html` con doble clic (`file://`): los navegadores lo bloquean. Hace falta un servidor estático cualquiera, por ejemplo:

```
npx serve .
```

o `python -m http.server 8080` en esta carpeta, y abrir `http://localhost:8080/`. En GitHub Pages funciona tal cual.

## Acceso

La contraseña la valida el backend (`panelLogin`), que devuelve un testigo de sesión. El testigo se guarda en `sessionStorage` y caduca (se borra al cerrar la pestaña). La contraseña no se guarda ni en el código ni en el navegador.

Si el testigo caduca en mitad del trabajo, se pide la contraseña encima de la pantalla y la operación se repite al entrar: no se pierde lo que estuviera escrito.

Para configurarla en el backend, ver `backend-propuesta/panel-acceso.gs`.
