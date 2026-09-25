# Decisiones del panel y dudas para el backend

**El contrato vive en [`BACKEND.md`](BACKEND.md)**, lo mantiene el backend y manda sobre este fichero. Aquí queda lo que decide el panel por su cuenta y lo que el panel pregunta. Revisado contra BACKEND.md **v3.20.27** el 25/09/2026.

## Clasificar factura a factura, con vista previa — hecho (v3.20.27)

- **Visor de factura** (`js/visor.js`). Se abre con «Ver y clasificar» en cada factura sin clasificar y con «Ver» en cualquier factura de la tabla de gastos de vehículo. A la izquierda, el PDF de `panelFacturaDetalle`; si no hay PDF, el motivo (`pdfError`) y la tabla de líneas con base y total. A la derecha, los datos y los tipos de `tiposFactura`.
  - El PDF se convierte de base64 a un `blob:` y se enseña en un `<iframe>`, no como `data:`, porque los navegadores bloquean a menudo los PDF `data:` dentro de un iframe. Si el tipo es una imagen, se enseña como imagen.
- **Factura a factura.** «Guardar clasificación» envía `panelClasificarFactura { id, tipo }`. Las sin clasificar se siguen agrupando por proveedor, con «Todas como [tipo] · Aplicar a todo el proveedor» (`panelClasificarProveedor`) para cuando todas son iguales.
- **Material de uso.** Al elegirlo aparecen casillas con `equiposDisponibles`, todas marcadas, y el reparto («30,00 € a cada uno»). Sin ninguna marcada, el botón de guardar no se activa. Se envía `equipos` solo con `materialUso`.
- **Emparejamiento:** `panelClasificarFactura` va con `panelCompras`, como las demás escrituras de compras.
- **Contador de pendientes en azul** (`--acento`).
- Tras cada clasificación se vuelve a leer `panelCompras`, así que el aviso y el contador se refrescan.
- Comprobado con el simulador local (en la demostración no hay PDF, así que se probó la vista de líneas): una factura suelta como material de uso entre dos equipos, el proveedor entero como herramienta y reabrir una factura ya clasificada.

**Duda para el backend:** la tabla de BACKEND.md da como respuesta de `panelClasificarFactura` `{ ok, id, tipo, equipos, avisos }`, sin `accion`. El panel exige `accion` en toda escritura (regla general del contrato) y, si no llega, dice «no se da por guardado». ¿Lo repite, como las demás?

## Aviso de facturas pendientes — hecho (Panel_Compras v1.13)

- **Contador en la pestaña «Combustible»**, visible desde cualquier pantalla: suma `pendientes.sinAsignar + pendientes.sinClasificar`, con el desglose al pasar el ratón. Se pide `panelCompras` del mes actual al entrar al panel (en la cola, detrás de la pantalla abierta) y se refresca con cada lectura de `panelCompras`, es decir, tras cada asignación o clasificación.
- **Aviso arriba en Combustible**: «Faltan N facturas por asignar matrícula o Estructura (importe) · M sin clasificar», con un botón por mes de `porMes` y `sinClasificarPorMes` que lleva a ese mes (pide confirmación si hay asignaciones sin guardar).
- Si `pendientes` llega `null` o todo a cero, no se pinta nada.
- Comprobado con el simulador local: el contador aparece al entrar en Unidades y baja al asignar una factura a Estructura.

## Desplegable de vehículo en Combustible — hecho (v3.20.24)

- El desplegable ofrece siempre los vehículos con `activo: true`, en cualquier mes, más la matrícula que ya tenga la factura aunque no esté activa.
- Nueva opción «Estructura (sin vehículo)», que se envía como `matricula: "ESTRUCTURA"`. Cuando `panelCompras` la devuelve, cuenta como asignada (no sale en «sin vehículo») y se rotula «Estructura».
- El resumen por vehículo tiene siempre una tarjeta «Estructura · sin vehículo», que también admite facturas arrastradas.
- Comprobado con el simulador local.

## Guardar asignaciones en producción — hecho (v3.20.22)

- **Unidades ya guarda en el sistema real.** El panel envía solo `{ asignaciones }`, con el formato exacto de BACKEND.md:
  - una fila por técnico que cambia de unidad: `{ idTec, idUnidad | null, desde }`, sin matrícula;
  - una fila por unidad cuya furgoneta cambia: `{ idTec: null, idUnidad, matricula | null, desde }`. Si una furgoneta pasa de una unidad a otra, salen las dos filas (la de origen con `null`).
- **Avisos.** Los `avisos` de la respuesta se muestran siempre, 20 segundos cada uno. Tras guardar se vuelve a leer `panelConfig`.
- **Técnicos y vehículos: solo consulta.** Mientras `panelGuardarConfig` vaya a producción, altas, bajas, ediciones y «Nueva unidad» van desactivados con el aviso «Próximamente». En la demostración siguen funcionando.
- Comprobado con el simulador local: mover una furgoneta de Búfala 1 a Búfala 2 y un técnico a Búfala 2 envía exactamente tres filas (técnico, Búfala 1 sin furgoneta, Búfala 2 con la furgoneta) y enseña el aviso del backend.

## Compras y costes en producción — hecho (v3.20.21)

El panel usa en producción lo que anuncia `ping.accionesPanel`, así que Combustible y Costes de personal ya leen y guardan en el sistema real sin tocar `api.js`. Ajustes al contrato:

- **Combustible y vehículos.** La pantalla muestra los gastos de tipo `combustible` y `vehiculo` (renting y mantenimiento), con una columna «Tipo». El resumen por vehículo separa combustible de renting y mantenimiento. `panelAsignarCombustible` se usa para los dos.
- **Líneas de proveedores mixtos.** Las de `sinClasificar` con `esLinea: true` llevan la marca «línea de factura mixta», y el aviso al clasificar habla de «las próximas líneas con ese texto». Se envía `proveedor` tal cual llega.
- **Costes.** `gestoria` y `manual` cuentan como coste real («coste de nómina» / «corregido a mano»). `estimacion` nunca se guarda: se ofrece como sugerencia («coste de referencia») cuando el mes anterior no tiene dato real. Al guardar se elige el origen: «Dato de la nómina» (`gestoria`, por defecto) o «Corrección manual» (`manual`).

## Peticiones de una en una — hecho (v3.20.18)

**Rectificación:** el fallo del 23/09 que atribuí a la comprobación del testigo no era eso. Era lo que explica BACKEND.md v3.20.18: Apps Script serializa las ejecuciones de un mismo usuario. Mi `curl` con testigo inventado coincidió con peticiones del panel en curso y quedó en cola.

**Encargo hecho:** todas las peticiones a producción pasan por una cola en `js/api.js` y salen **de una en una**: `ping`, `panelLogin`, `panelConfig` y cualquier acción futura. Cubre `combustible.js` y `costes.js` sin tocar las pantallas, y también la Liquidación, que lee la configuración a la vez que la liquidación. Las peticiones de demostración no salen del navegador y no usan la cola.

Comprobado con un simulador local que cuenta las peticiones simultáneas: tres lecturas lanzadas a la vez desde el panel llegan de una en una (máximo 1). Las mismas tres lanzadas a mano, sin la cola, llegan a la vez (máximo 3).

Además, el panel guarda en memoria una copia de `panelConfig` durante 10 minutos, o hasta guardar. Se suma a la caché del backend (`cache: true`). El panel no envía `&nocache=1`: tras `panelGuardarConfig` la caché del backend se invalida sola, y la del panel también.

## Dudas abiertas para el backend

1. **`panelClasificarFactura` y `accion`:** ¿la respuesta repite `accion`? Detalle en «Clasificar factura a factura».

Además, Pendiente del backend: altas y bajas de técnicos, vehículos y unidades dentro de `panelGuardarConfig`, y `panelLiquidacion`.

## Resueltas por BACKEND.md (23/09/2026, tarde) — hecho

- **Vehículo al guardar.** Además de una fila por técnico que cambia, el panel envía la fila de la unidad (`{ idTec: null, idUnidad, matricula, desde }`) **siempre que cambie su vehículo**, tenga técnicos o no. Si el vehículo pasa de una unidad a otra, salen dos filas de unidad: la de origen con `matricula: null` y la de destino con la matrícula. También se envía cuando una unidad se queda sin técnicos y conserva el vehículo.
- **Roles.** Quitado el filtro que solo dejaba asignar `Instalador`: cualquier técnico va a cualquier unidad. El rol se ve en la ficha. Si un `SAT` o `Gerencia` va a una brigada, o un `Instalador`/`Jefe` a una no productiva, sale un aviso («Ojo: …»), pero no se impide.
- **Alta de unidades.** El formulario pide nombre y tipo y envía `{ nombre, tipo }`; `computaVariable` no se envía. Antes de enviar, el panel comprueba que no exista ya una unidad con ese nombre (sin distinguir mayúsculas) y no hace el viaje. La demostración imita al backend: id = nombre, rechaza duplicados y deriva `computaVariable` de «Búfala N».
- **`panelLiquidacion.filas[].unidad` es el `id`.** El panel ya solo compara con el `id` y muestra el `nombre` de la unidad en la tabla.

## Resueltas por BACKEND.md v3.20.15

- **Vehículo de Gerencia.** Pertenece a la unidad `Gerencia` («Estructura») por su asignación `derivada`. Ya no sale como libre.
- **`brigada` frente a `asignaciones`.** El vínculo vehículo → unidad llega como asignación `derivada: true`. El panel usa las asignaciones y muestra `brigada` solo como dato.
- **Fechas `null`.** `desde: null` significa «desde siempre». Por eso ya no hay «hueco» antes del 01/09/2026: el aviso de «sin composición registrada» solo sale si ninguna asignación vale desde siempre.
- **Unidades no productivas publicadas** (`tipo: "productiva" | "no_productiva"`). Se han quitado las unidades de ejemplo que el panel añadía mientras tanto.
- **Los ids de unidad son cadenas opacas** («Búfala 1», «SAT», «Gerencia»). El panel no supone ningún formato; siempre muestra `nombre` y trabaja con `id`.
- **`ids` en las altas**, **forma de `panelCostes`**, **`tiposProveedor` como `{ valor, etiqueta }`** y **acciones según `ping.accionesPanel`**: hecho.

## Decisiones del panel

**Qué va a producción.** Al cargar la página, el panel pregunta `GET ?action=ping`:
- Si `panel` no es `true` o no llega `accionesPanel`, no se hace ningún POST y no se puede entrar.
- Solo se tienen en cuenta los nombres de acción que el panel conoce.
- El acceso nunca se simula.
- Si el `ping` falla, se reintenta en la siguiente llamada.

**Lecturas y escrituras emparejadas.** Cada escritura depende de una lectura:

| Escritura | Lectura |
|---|---|
| `panelGuardarConfig` | `panelConfig` |
| `panelAsignarCombustible`, `panelClasificarProveedor` | `panelCompras` |
| `panelCostesTecnico` | `panelCostes` |

Si una va a producción y la otra no, la escritura se bloquea y no se envía nada. Así nunca se guarda en la demostración algo leído del sistema real, ni se manda al sistema real algo leído de la demostración.

**Unidades.**
- Las brigadas (`productiva`) y las no productivas se pintan en zonas separadas.
- `limites.tecnicosPorUnidad` no se aplica a las no productivas.
- Las unidades con `computaVariable: false` llevan la marca «no computa variable». En Liquidación, si llegara alguna fila suya, se aparta con un aviso y no se muestra como reparto. El total es siempre el que manda el servidor: el panel no suma.
- Los vehículos `sinMatricula: true` se muestran con el aviso «sin matrícula».

**Respuestas del backend.**
- `rechazado:true`: se muestra el error del servidor, sin reintentar.
- `bloqueado:true`: se muestra en la pantalla de acceso.
- `codigo:"sesion"`: se pide la contraseña y se repite la operación.
- Una escritura cuya respuesta no repite `accion` no se da por guardada.

**Interfaz.**
- JavaScript nativo, sin bibliotecas. El arrastre usa la API de HTML5, con un desplegable «Mover a…» para pantallas táctiles.
- Los borradores solo viven en memoria: no se guardan en el navegador porque incluyen importes salariales.
- El panel no calcula el variable: muestra lo que manda `panelLiquidacion`.
- Una unidad de un técnico es normal y no se avisa.
- El histórico de costes marca cada mes como «coste real» si todos los técnicos activos tienen `origen === "gestoria"`, o como «estimación (x de y reales)».
- Versión única `?v=N` en `index.html` y en todos los `import` (`node subir-version.mjs`), para que la caché no mezcle ficheros de dos versiones.
- Con `file://` los módulos no cargan; en GitHub Pages o con un servidor estático, sí.

**Desarrollo.** Nunca se llama a producción mientras se desarrolla, salvo las pruebas que pida el backend y solo con las acciones de `accionesPanel`. El resto se prueba con un simulador local que sirve el panel con la URL del backend cambiada a `localhost`.

## Historial

- **23/09/2026, 17:52 · «No se puede contactar con el servidor» al entrar.** Fallo momentáneo de Google: un `ping` a esa hora tardó más de 40 s y minutos después respondía en 7 s. Cuando Apps Script falla así, su página de error no trae cabeceras CORS y el navegador lo ve como fallo de red. El mensaje del panel ahora lo dice y propone reintentar al cabo de un minuto.

- **23/09/2026 · prueba de `panelConfig` en producción (v3.20.14).** Fue una prueba de solo lectura. Salieron `ping`, `panelLogin` y `panelConfig`, y no se guardó nada. Encajaron los técnicos con `rol`, las tres brigadas, el límite de 2 y la respuesta `codigo:"sesion"`. Las dudas que dejó las resolvió la v3.20.15.
- **22/09/2026 · incidente de la cola de cierres (cerrado).** Siete POST de prueba se encolaron como cierres de obra en la v3.20.7. Desde la v3.20.8, el backend rechaza las peticiones vacías y las acciones desconocidas.
