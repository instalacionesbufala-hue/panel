# Decisiones y puntos pendientes del contrato

El encargo pide avisar antes de improvisar cuando el contrato no encaja. Lo que sigue son **propuestas** que el backend tiene que aceptar o cambiar. El panel ya está hecho según ellas, y cambiarlas es cuestión de pocas líneas en `js/api.js` o en la pantalla afectada.

## 0. Hallazgo crítico: el backend actual encola cualquier POST como cierre de obra

Al comprobar la URL activa (v3.20.7, 22/09/2026):

- `GET ?action=panelConfig` (y cualquier acción desconocida) devuelve la página HTML «endpoint activo», **sin cabecera CORS**. Desde el navegador eso se ve como un error de red.
- `POST ?action=<lo que sea>` **no mira `action`**: lo trata como un cierre de obra, crea un fichero `COLA_<fecha>_SIN_ID.json` en la cola y responde `{"ok":true,"encolado":true}`.

Por eso las pruebas de conexión de este encargo crearon **7 ficheros basura** en la cola (22/09/2026, entre las 20:55 y las 21:10, hora peninsular):

| Fichero | Carpeta (id) | Estado |
|---|---|---|
| COLA_20260922_205547_SIN_ID.json | 1RhypLCHkgHXt0KB5vhVECRQm8Qyr5zSB | ya procesado por la cola |
| COLA_20260922_205601_SIN_ID.json | 1RhypLCHkgHXt0KB5vhVECRQm8Qyr5zSB | ya procesado por la cola |
| COLA_20260922_205618_SIN_ID.json | 1RhypLCHkgHXt0KB5vhVECRQm8Qyr5zSB | ya procesado por la cola |
| COLA_20260922_211002_SIN_ID.json | 1EgjJUq8qfrqR9MmHiZPf-pbv_Cp9A5n8 | aparentemente pendiente |
| COLA_20260922_211017_SIN_ID.json | 1EgjJUq8qfrqR9MmHiZPf-pbv_Cp9A5n8 | aparentemente pendiente |
| COLA_20260922_211022_SIN_ID.json | 1EgjJUq8qfrqR9MmHiZPf-pbv_Cp9A5n8 | aparentemente pendiente |
| COLA_20260922_211036_SIN_ID.json | 1EgjJUq8qfrqR9MmHiZPf-pbv_Cp9A5n8 | aparentemente pendiente |

Son de 2 a 23 bytes, sin datos de obra. Hay que revisar si el procesado dejó filas vacías en el Registro o en las prefacturas, o mandó correos de error, y retirar los pendientes antes de que los procese la cola.

**Cómo se evita ahora:**
1. **Modo demostración.** Solo van a producción las acciones que el backend ha confirmado (conjunto `EN_PRODUCCION` en `js/api.js`). A 23/09/2026 solo `panelLogin`. Lo demás se sirve con datos de ejemplo en memoria.
2. En toda escritura a producción (salvo el acceso) el panel exige que la respuesta repita la acción (`"accion": "panelGuardarConfig"`, etc.). Si no la repite, no da nada por guardado.
3. Durante el desarrollo no se llama a producción: las pruebas se hacen con los datos de demostración y con `fetch` interceptado en el navegador.

## 1. Sesión (sección 6 del encargo)

El contrato no fija la forma exacta. Propuesta implementada:

- **Implementado en el backend:** `POST` con `payload={"accion":"panelLogin","clave":"…"}` → `{ ok, token, caduca }` o `{ ok:false, error }`; tras 5 fallos, `bloqueado:true` durante 15 minutos.
- En las escrituras la acción viaja **dentro de `payload`** (`"accion": "…"`), igual que en el acceso. En las lecturas va como `?action=`. Hay que confirmarlo cuando el backend implemente el resto.
- El testigo viaja como campo `token`: en la *query string* en las lecturas y como campo del formulario (junto a `payload`) en las escrituras. Apps Script no deja leer cabeceras, y una cabecera propia obligaría a una comprobación CORS previa que Apps Script no contesta.
- Testigo caducado → `{ ok:false, codigo:"sesion", error:"…" }`. El panel pide la contraseña y repite la operación.
- Mientras no hay `caduca`, el panel confía en que el backend avise.

## 2. Asignaciones (pantalla de unidades)

- Cada fila de `asignaciones` combina técnico + unidad + matrícula. Al guardar, el panel envía una fila nueva **por técnico cuya unidad o vehículo cambia**, con `desde` = fecha de efecto y `hasta: null`. El backend cierra la anterior (`hasta` = día antes).
- **Sacar a un técnico de su unidad** se envía como `{ idTec, idUnidad: null, matricula: null, desde }`. El contrato no lo contemplaba.
- **Unidad con vehículo y sin técnicos**: `{ idTec: null, idUnidad, matricula, desde }`; para retirar ese vehículo, la misma fila con `matricula: null`. Tampoco estaba contemplado.
- `hasta` se interpreta **inclusive** (último día vigente). Igual con `baja` de técnicos y `hasta` de vehículos.
- **Máximo de técnicos por unidad**: el panel no fija ninguno (no se ponen parámetros de negocio en el código). Si el backend manda `limites.tecnicosPorUnidad` en `panelConfig`, el panel lo aplica al soltar. Una unidad de un técnico se muestra como «1 técnico», sin avisos.
- Los días pasados se consultan en solo lectura. La fecha de efecto es la del selector (hoy por defecto, o una futura). **No hay correcciones retroactivas** desde el panel; si hacen falta, se añaden.

## 3. Unidades y bajas

- Una unidad se da de baja con `{ id, activa:false, hasta:"AAAA-MM-DD" }`. El contrato solo tenía `activa`; se añade `hasta` para conservar la fecha.
- Técnico: `baja`. Vehículo: `hasta`. En ningún caso se borra nada.
- El identificador de un alta nueva (T07, U4…) lo propone el panel y se puede cambiar. Si el backend prefiere asignarlo él, se cambia.

## 4. Costes de personal

- **No hay acción para leer costes guardados.** El panel usa `panelLiquidacion` del mes (campos `costeTec` y `origenCostes`) para saber qué está guardado, y la del mes anterior para las sugerencias. El historial de «coste real / estimación» consulta las liquidaciones de los últimos 6 meses (6 llamadas).
  → Recomendado: `GET ?action=panelCostes&desde=AAAA-MM&hasta=AAAA-MM` que devuelva los costes y su origen por mes.
- Se considera coste real cuando `origenCostes === "gestoria"`; cualquier otro valor cuenta como estimación.
- CSV opcional: separador `;`, `,` o tabulador; cada línea con el identificador o el nombre del técnico y el importe (formato español o con punto). Las líneas que no casan se listan. Nada se envía hasta pulsar «Guardar costes».

## 5. Combustible

- El contrato no permite **quitar** un vehículo ya asignado a una factura, solo cambiarlo por otro. El panel no ofrece «sin vehículo» en facturas ya guardadas.
- La comparación con el mes anterior pide `panelCompras` de los dos meses.
- Los cuatro tipos con los que se clasifica un proveedor son los del contrato (`combustible`, `material`, `vehiculo`, `estructura`).

## 6. Otras decisiones

- **Sin framework ni bibliotecas**: JavaScript nativo con módulos. El arrastre usa la API nativa de HTML5. En pantallas táctiles cada ficha lleva un desplegable «Mover a…» que hace lo mismo.
- Borradores **solo en memoria**. No se guardan en el navegador porque incluyen importes salariales. Si se cae la conexión o caduca la sesión, lo escrito sigue en pantalla. Solo se pierde al cerrar o recargar la pestaña, y el panel avisa antes si hay cambios sin guardar.
- El panel no calcula el variable: muestra lo que manda `panelLiquidacion`. Las sumas de la pantalla de combustible son totales de facturas, no cálculo de negocio.
- `file://`: los navegadores bloquean los módulos ES al abrir `index.html` con doble clic. En GitHub Pages o con cualquier servidor estático funciona.

## Pendiente

1. Limpiar las 7 entradas `SIN_ID` de la cola y revisar sus efectos (punto 0).
2. ~~Backend: `panelLogin`~~ Hecho (23/09/2026).
3. Backend: acciones de datos `panelConfig`, `panelCompras`, `panelLiquidacion`, `panelGuardarConfig`, `panelAsignarCombustible`, `panelClasificarProveedor`, `panelCostesTecnico`, que devuelvan `accion` en las escrituras.
4. Acordar los puntos 1–5 y, si se acepta, `panelCostes`.
5. Ir pasando cada acción a `EN_PRODUCCION` a medida que el backend la confirme, y probarla entonces.
