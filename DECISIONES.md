# Decisiones del panel y dudas para el backend

**El contrato vive en [`BACKEND.md`](BACKEND.md)**, lo mantiene el backend y manda sobre este fichero. Aquí queda lo que decide el panel por su cuenta y lo que el panel pregunta. Revisado contra BACKEND.md (v3.20.12) el 23/09/2026.

## Dudas abiertas para el backend

1. **¿`panelConfig` y `panelGuardarConfig` saldrán juntas?** BACKEND.md anuncia `panelConfig` como la siguiente y el resto después. Mientras una lectura esté en producción y su escritura no (o al revés), el panel **bloquea esa escritura** y muestra «Aún no se puede guardar» (ver «Lecturas y escrituras emparejadas»). Si `panelConfig` sale sola, las pantallas Unidades y Técnicos y vehículos serán de solo consulta hasta que llegue `panelGuardarConfig`. ¿Es lo que queréis, o preferís publicarlas juntas? Lo mismo vale para las parejas `panelCompras` ↔ `panelAsignarCombustible` / `panelClasificarProveedor` y `panelCostes` ↔ `panelCostesTecnico`.

## Resueltas por BACKEND.md (23/09/2026)

- `ids: { tecnicos, unidades }` en la respuesta de `panelGuardarConfig`. El panel ya lo lee y muestra los identificadores asignados.
- Forma de `panelCostes`: lista plana `costes: [{ mes, idTec, costeEmpresaMes, origen }]`. Es la que ya usa el panel.
- `tiposProveedor`: objetos `{ valor, etiqueta }`, sin `sinClasificar`. El panel ya los muestra con su etiqueta; la demostración usa esa forma.
- Acciones en producción según `ping.accionesPanel`. Hecho: ya no hay lista fija en el código.

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

**Respuestas del backend.**
- `rechazado:true`: se muestra el error del servidor, sin reintentar.
- `bloqueado:true`: se muestra en la pantalla de acceso.
- `codigo:"sesion"`: se pide la contraseña y se repite la operación.
- Una escritura cuya respuesta no repite `accion` no se da por guardada.

**Interfaz.**
- JavaScript nativo, sin bibliotecas. El arrastre usa la API de HTML5, con un desplegable «Mover a…» para pantallas táctiles.
- Los borradores solo viven en memoria: no se guardan en el navegador porque incluyen importes salariales.
- El panel no calcula el variable: muestra lo que manda `panelLiquidacion`.
- Una unidad de un técnico es normal y no se avisa. El máximo por unidad sale de `limites.tecnicosPorUnidad` y se comprueba al soltar.
- El histórico de costes marca cada mes como «coste real» si todos los técnicos activos tienen `origen === "gestoria"`, o como «estimación (x de y reales)».
- Con `file://` los módulos no cargan; en GitHub Pages o con un servidor estático, sí.

**Desarrollo.** Nunca se llama a producción mientras se desarrolla. Las pruebas se hacen con un simulador local que sirve el panel con la URL del backend cambiada a `localhost`.
