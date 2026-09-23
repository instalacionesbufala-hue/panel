# Decisiones del panel y dudas para el backend

**El contrato vive en [`BACKEND.md`](BACKEND.md)**, lo mantiene el backend y manda sobre este fichero. Aquí queda lo que decide el panel por su cuenta y lo que el panel pregunta. Revisado contra BACKEND.md **v3.20.18** (`Panel_Config.gs` v1.3) el 23/09/2026.

## Peticiones de una en una — hecho (v3.20.18)

**Rectificación:** el fallo del 23/09 que atribuí a la comprobación del testigo no era eso. Era lo que explica BACKEND.md v3.20.18: Apps Script serializa las ejecuciones de un mismo usuario. Mi `curl` con testigo inventado coincidió con peticiones del panel en curso y quedó en cola.

**Encargo hecho:** todas las peticiones a producción pasan por una cola en `js/api.js` y salen **de una en una**: `ping`, `panelLogin`, `panelConfig` y cualquier acción futura. Cubre `combustible.js` y `costes.js` sin tocar las pantallas, y también la Liquidación, que lee la configuración a la vez que la liquidación. Las peticiones de demostración no salen del navegador y no usan la cola.

Comprobado con un simulador local que cuenta las peticiones simultáneas: tres lecturas lanzadas a la vez desde el panel llegan de una en una (máximo 1). Las mismas tres lanzadas a mano, sin la cola, llegan a la vez (máximo 3).

Además, el panel guarda en memoria una copia de `panelConfig` durante 10 minutos, o hasta guardar. Se suma a la caché del backend (`cache: true`). El panel no envía `&nocache=1`: tras `panelGuardarConfig` la caché del backend se invalida sola, y la del panel también.

## Dudas abiertas para el backend

1. **`panelConfig` está en producción, pero `panelGuardarConfig` no.** Como estaba previsto, el panel bloquea esa escritura: Unidades y Técnicos y vehículos son de solo consulta hasta que llegue `panelGuardarConfig`.
2. **Cómo se envía el vehículo al guardar, ahora que hay asignaciones `derivada`.** El panel envía una fila por técnico que cambia, con la matrícula del vehículo de su unidad (`{ idTec, idUnidad, matricula, desde }`). Solo cuando una unidad se queda sin técnicos envía la fila del vehículo solo (`{ idTec: null, idUnidad, matricula, desde }`). Si cambia el vehículo de una unidad con técnicos, no envía fila de vehículo aparte: se deduce de las filas de sus técnicos. ¿Es el formato que va a leer `panelGuardarConfig`, o preferís una fila de vehículo explícita siempre que el vehículo cambie?
3. **¿Qué roles puede recibir cada unidad?** Hoy el panel solo deja asignar técnicos con rol `Instalador`, también en SAT y Estructura, como se pidió («igual que las demás»). Con esa regla no se puede pasar desde el panel al técnico de rol SAT a la unidad SAT, ni al de Gerencia a Estructura. Si el backend ya los manda asignados ahí, se ven bien. BACKEND.md menciona también el rol `Jefe`. Preguntas:
   - ¿Pueden las no productivas recibir los roles SAT y Gerencia?
   - ¿Puede un `Jefe` ir en una brigada?
4. **Alta de unidades.** El formulario «Nueva unidad» solo envía `nombre`. ¿Debe pedir también `tipo` y `computaVariable`? Y como el id de una unidad es su nombre en la hoja, ¿qué pasa si se da de alta una con un nombre que ya existe?
5. **`panelLiquidacion.filas[].unidad`: ¿id o nombre?** Para apartar las unidades que no computan variable, el panel compara con los dos (`Gerencia` y `Estructura`). Bastaría con saber cuál llega.

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
- Si un técnico no trae `rol` (datos antiguos), se considera asignable.

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

- **23/09/2026 · prueba de `panelConfig` en producción (v3.20.14).** Fue una prueba de solo lectura. Salieron `ping`, `panelLogin` y `panelConfig`, y no se guardó nada. Encajaron los técnicos con `rol`, las tres brigadas, el límite de 2 y la respuesta `codigo:"sesion"`. Las dudas que dejó las resolvió la v3.20.15.
- **22/09/2026 · incidente de la cola de cierres (cerrado).** Siete POST de prueba se encolaron como cierres de obra en la v3.20.7. Desde la v3.20.8, el backend rechaza las peticiones vacías y las acciones desconocidas.
