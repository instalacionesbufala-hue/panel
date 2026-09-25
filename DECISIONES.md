# Decisiones del panel y dudas para el backend

**El contrato vive en [`BACKEND.md`](BACKEND.md)**, lo mantiene el backend y manda sobre este fichero. Aquí queda lo que decide el panel por su cuenta y lo que el panel pregunta. Revisado contra BACKEND.md **v3.20.38** el 26/09/2026.

## Ausencias: Holded es la fuente oficial — hecho (encargo 5, v3.20.38)

- **Aviso fijo** arriba en «Ausencias»: «Las ausencias se registran en Holded. Se gestionan en Holded · se actualizan cada mañana (7:00)».
- **Las de Holded, de solo consulta.** Una ausencia es de Holded si `origen === "holded"`; si no llegara `origen`, se mira si el `id` empieza por `H`.
  - En la lista llevan la etiqueta «Holded» y «Se cambia en Holded» en lugar de Corregir y Borrar.
  - En el calendario, al pulsarlas se abre una ficha de solo lectura que explica que se cambian o anulan en Holded.
  - El panel nunca envía `panelGuardarAusencia` ni `panelBorrarAusencia` con una de Holded. Si el backend lo rechazara igualmente, se enseña su `error`.
- **Alta manual excepcional.** Desaparece el formulario de alta rápida. Queda un botón secundario, «Añadir ausencia fuera de Holded», y el clic en un día vacío del calendario. El diálogo avisa de que, si luego se registra en Holded, la de Holded la sustituirá.
- **Marcas:** las manuales llevan la etiqueta «fuera de Holded» en la lista y una esquina marcada en el calendario, con su leyenda.
- Comprobado con el simulador local: ficha de solo lectura de una de Holded, alta fuera de Holded con su aviso y lista con las dos procedencias.

## Régimen de cada unidad: servicios/día y jornada con fecha — hecho (encargo 4, v3.20.34)

En producción desde que el ping anuncia `panelParametrosUnidades` y `panelGuardarParametroUnidad`. La escritura va emparejada con esa lectura. Código en `js/regimen.js`, enganchado a «Unidades».
- **En cada tarjeta de unidad**, su régimen el día elegido: «2 servicios/día · 7 h 42 min», o el suyo propio en azul con «desde dd/mm/aaaa», por ejemplo «1 servicio/día · 5 h (08:30-13:30) desde 09/09/2026».
  - Se calcula en el navegador con la fila de esa unidad cuya fecha sea la más reciente sin pasar del día; sin filas, `porDefecto`.
  - Se lee aparte de `panelConfig`: si falla, la composición se sigue viendo y la tarjeta dice «Régimen no disponible · reintentar».
- **Al pulsarlo**, un diálogo con:
  - el régimen del día y la regla de cálculo del backend (capacidad = mín(servicios, técnicos presentes); jornada del día = jornada × capacidad ÷ servicios);
  - el **historial** de la unidad, con «Borrar» en cada fila (envía `borrar: true` con la unidad y la fecha, tras confirmar);
  - **«Cambiar a partir de…»**: fecha (por defecto hoy, o el día elegido si es futuro), servicios/día (0-4), entrada y salida y notas. Con entrada y salida, la jornada en minutos se calcula sola y se puede corregir a mano (1-720). `horario` se envía como «HH:MM-HH:MM».
- Tras guardar o borrar se vuelve a leer el régimen. Si la respuesta trae `costesEnCola`, sale el aviso de siempre.
- Comprobado con el simulador local: régimen propio de Búfala 1 y por defecto en las demás, cambio de Búfala 2 con horario 08:00-14:00 (sale 360 min) y borrado de una fila del historial.

## Pestaña «Configuración»: festivos y precios de material — hecha en modo demostración (encargo 3, 26/09/2026)

Nueva pestaña «Configuración» (`js/configuracion.js`). Irá sola a producción cuando el ping anuncie `panelFestivos`, `panelGuardarFestivo`, `panelBorrarFestivo`, `panelPrecios` y `panelGuardarPrecios`. Las escrituras van emparejadas con su lectura (`panelFestivos` y `panelPrecios`).

**Festivos**
- Lista del año con selector (año anterior, actual y siguiente), el día de la semana y el ámbito.
- **Alta rápida** con fecha, nombre y ámbito. El ámbito se escribe libre, con sugerencias: «Nacional», «Comunidad de Madrid» y «Local».
- Antes de enviar, el panel avisa si la fecha ya existe; el backend también la rechaza.
- **Corregir** envía `fechaAnterior`. **Borrar** pide confirmación y avisa de que el día volverá a ser laborable.
- **Fin de semana:** la marca «fin de semana» sale en la fila, en el recuento del año y en el aviso al guardar («no resta días laborables»).

**Precios de coste de material**
- Tabla agrupada por familia (`titulo`). Solo se editan en línea el **coste** y las **notas**; `id` y `concepto` se ven, pero no se pueden cambiar.
- Mientras no se guarda, la fila queda marcada y enseña «antes X €». Un cambio que vuelve al valor original deja de contar.
- Un solo **«Guardar cambios»** envía `{ cambios: [{ id, coste, notas? }] }`, solo con los que han cambiado. Las `notas` se envían solo si cambian.
- Antes de guardar, una confirmación recuerda que se recalcula el coste de material de todas las instalaciones. Hay «Descartar», y el panel avisa al salir de la pantalla con cambios sin guardar.
- Los `avisos` de la respuesta se enseñan siempre.
- Comprobado con el simulador local:
  - festivos: alta repetida rechazada, alta correcta y marca de fin de semana;
  - precios: cambio y vuelta al original, y dos cambios guardados de una vez.

## Pantalla «Ausencias» — hecha, en producción desde v3.20.30

Nueva pestaña «Ausencias» (`js/ausencias.js`). Desde la v3.20.30 el ping anuncia `panelAusencias`, `panelGuardarAusencia` y `panelBorrarAusencia`, así que va a producción sola. Las dos escrituras van emparejadas con `panelAusencias`.
- Se lee el **año entero** (`desde = AAAA-01-01`, `hasta = AAAA-12-31`) y el mes se filtra en el navegador; al cambiar de año se vuelve a leer.
- **Alta**: desde la v3.20.38 solo excepcional (ver «Holded es la fuente oficial»). Si el backend rechaza, por ejemplo por un **solape**, se enseña su `error` y se conserva lo escrito.
- **Calendario del mes**: una fila por técnico y una columna por día, con fines de semana sombreados y un color por motivo. Pulsar un día vacío abre el alta con ese técnico y ese día; pulsar una ausencia abre su corrección.
- **Lista del mes** con Corregir y Borrar (borrar pide confirmación). Filtros de técnico y motivo.
- **Resumen del año**: días laborables de vacaciones disfrutados y cuántos quedan de 22, y el resto de motivos. Una ausencia cuenta en el año en que empieza.
- **Ajustes de la v3.20.30:**
  - Las ausencias que llegan **sin `idTecnico`** (el nombre de la hoja no casa con ningún empleado) salen en una fila propia del calendario y con la marca «sin casar» en la lista. Al corregirlas, el diálogo explica qué pone en la hoja y pide elegir el técnico.
  - `tecnicos` trae `activo`: en las altas solo se ofrecen los activos. Los de baja salen en el calendario y en el resumen solo si tienen ausencias ese año, marcados «de baja».
  - Los `avisos` de `panelGuardarAusencia` (por ejemplo, unidad que no computa en ninguna brigada) se enseñan siempre.
- Los días laborables y el `equipo` los pone el backend; el panel no los calcula (la demostración sí, de lunes a viernes con una lista de festivos de ejemplo).

## Página de la Dirección General — hecha, en producción desde v3.20.30

`direccion.html` + `js/direccion.js`, con el mismo estilo que el panel. Página aparte, **solo lectura** y **sin enlaces al panel**.
- **Acceso propio.** Su testigo se guarda aparte (`bufala-direccion-testigo`) y solo se usa en las acciones `direccion*`. Además, `api.peticionDireccion` rechaza cualquier otra acción. Mientras el ping no anuncie `direccionLogin`, no se pide contraseña y la página enseña **datos de ejemplo** con una franja que lo dice.
- Usa la misma cola, el mismo reintento y el mismo `ping` que el panel. Las acciones `direccion*` no cuentan para la franja de «Modo demostración» del panel.
- **Secciones:** Semanal (con la tabla por equipo), Mensual, Trimestral, Por incorporación e Informe Semanal, cada una con su periodicidad bien visible y su selector (semana, mes o trimestre). Cada indicador es una tarjeta con valor, unidad, nota, «Fórmula» plegable y la marca «dato manual» cuando corresponde.
- **Periodos por defecto:** la última semana completa, el último mes cerrado y el último trimestre cerrado. La semana se envía como `AAAA-Snn` (el selector del navegador da `AAAA-Wnn` y se convierte).
- **Informe Semanal:** «Ver informe» pide `direccionInforme`, enseña el `.md` y permite descargar `.md` y `.csv` con el nombre `BUFALA_Informe_Operaciones_AAAA-Snn` (el `.csv` lleva BOM para que Excel lea bien los acentos).
- **Valores:** los porcentajes que lleguen como fracción (0,82) se enseñan como 82 %.

## Reintento, aviso tras guardar y equipos en cualquier compra — hecho (v3.20.28)

- **Reintento automático** (`js/api.js`). Si Google devuelve su página de error, no contesta, o tarda más de 30 s (antes se esperaban 60), la petición se repite **una sola vez** a los 4 s, con el aviso «Reintentando…». Si falla también el segundo intento, sale el error de siempre y la franja de conexión. Un «no» del backend (`ok:false`) nunca se repite. Va dentro de la cola, así que no se adelanta a otras peticiones.
  - También se reintenta el «fallo de red»: la página de error de Google no trae cabeceras CORS y el navegador la ve así (es lo que pasó el 23/09).
- **Tras guardar**, si la respuesta trae `costesEnCola: true`, aviso discreto «Guardado. Los costes se actualizan en 1-2 minutos». Uno solo aunque se guarde varias veces en 20 s.
- **Equipos en material y herramienta.** En el visor, los tipos de `tiposConEquipos` muestran las casillas de `equiposDisponibles`:
  - `materialUso`: obligatorias, todas marcadas al elegirlo;
  - `herramienta` y `material`: opcionales, sin marcar al elegirlo, con la explicación de qué pasa sin equipos (herramienta → Estructura; material → no suma, es el de los cierres);
  - si la factura ya tenía equipos para ese tipo, se parte de ellos. Se envía siempre `equipos` (vacío en los opcionales) con esos tipos; para cambiar solo los equipos se reenvía el mismo `tipo`.
- **Nueva lista «Material y herramienta» del mes** en Combustible: cada compra de `tiposConEquipos` con su tipo, «a mano» si `manual`, sus equipos y el reparto («150,00 € a cada uno»), o adónde va sin equipos. Botón «Ver y cambiar».
- Comprobado con el simulador local: reintento que sale bien al segundo intento (dos peticiones, ninguna franja de error), reintento que falla dos veces (dos peticiones y el error), herramienta sin equipos, material con dos equipos y el aviso de costes en cola.

## Clasificar factura a factura, con vista previa — hecho (v3.20.27)

- **Visor de factura** (`js/visor.js`). Se abre con «Ver y clasificar» en cada factura sin clasificar y con «Ver» en cualquier factura de la tabla de gastos de vehículo. A la izquierda, el PDF de `panelFacturaDetalle`; si no hay PDF, el motivo (`pdfError`) y la tabla de líneas con base y total. A la derecha, los datos y los tipos de `tiposFactura`.
  - El PDF se convierte de base64 a un `blob:` y se enseña en un `<iframe>`, no como `data:`, porque los navegadores bloquean a menudo los PDF `data:` dentro de un iframe. Si el tipo es una imagen, se enseña como imagen.
- **Factura a factura.** «Guardar clasificación» envía `panelClasificarFactura { id, tipo }`. Las sin clasificar se siguen agrupando por proveedor, con «Todas como [tipo] · Aplicar a todo el proveedor» (`panelClasificarProveedor`) para cuando todas son iguales.
- **Material de uso.** Al elegirlo aparecen casillas con `equiposDisponibles`, todas marcadas, y el reparto («30,00 € a cada uno»). Sin ninguna marcada, el botón de guardar no se activa. Se envía `equipos` solo con `materialUso`.
- **Emparejamiento:** `panelClasificarFactura` va con `panelCompras`, como las demás escrituras de compras.
- **Contador de pendientes en azul** (`--acento`).
- Tras cada clasificación se vuelve a leer `panelCompras`, así que el aviso y el contador se refrescan.
- Comprobado con el simulador local (en la demostración no hay PDF, así que se probó la vista de líneas): una factura suelta como material de uso entre dos equipos, el proveedor entero como herramienta y reabrir una factura ya clasificada.

**Resuelta:** la respuesta de `panelClasificarFactura` siempre trae `accion: "panelClasificarFactura"` (confirmado por el backend el 25/09/2026), así que la comprobación general de `accion` vale también aquí.

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

Ninguna por ahora. Resueltas por BACKEND.md v3.20.30:
- **`accion`:** todas las respuestas la traen (ausencias y `direccion*` incluidas).
- **`direccion*` en el ping:** en la misma lista `accionesPanel`.
- **Sesión caducada en la Dirección:** `{ ok:false, codigo:"sesion" }`, como en el panel. Los testigos del panel y de la Dirección no sirven el uno para el otro.
- **Porcentajes:** llegan como fracción con `unidad: "%"`, y `valor` es `null` cuando `datoManual: true`. Es como ya lo trataba el panel.

Pendiente del backend: altas y bajas de técnicos, vehículos y unidades dentro de `panelGuardarConfig`, y `panelLiquidacion`.

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
