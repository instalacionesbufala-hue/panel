# Decisiones del panel y dudas para el backend

**El contrato vive en [`BACKEND.md`](BACKEND.md)**, lo mantiene el backend y manda sobre este fichero. Aquí queda lo que decide el panel por su cuenta y lo que el panel pregunta. Revisado contra BACKEND.md (v3.20.12) y contra el mensaje del backend sobre `panelConfig` (v3.20.13+) el 23/09/2026. Mientras BACKEND.md no recoja ese mensaje, el panel sigue el mensaje.

## Prueba de `panelConfig` en producción (23/09/2026, backend v3.20.14)

Prueba de solo lectura de las pantallas Unidades y Técnicos y vehículos. Salieron `ping`, `panelLogin` y `panelConfig`. No se guardó nada: `panelGuardarConfig` aún no está en `accionesPanel`, así que el panel bloquea los guardados («Aún no se puede guardar»).

**Encaja:**
- Técnicos `E01…E09` con `rol`, y `grupo` a `null`.
- Unidades `U1…U3`, 2 técnicos y 1 vehículo en cada una desde el 01/09/2026.
- `limites.tecnicosPorUnidad = 2`, que el panel aplica al soltar.
- `tramos` vacío y `ejercicio` sin `diasEfectivos`.
- Sin testigo, `{ ok:false, codigo:"sesion" }`.
- La `brigada` de cada vehículo coincide hoy con las asignaciones.
- SAT (E05) y Gerencia (E06) no aparecen como asignables. La baja de E07 no aparece.

**No encaja, o hay que decidirlo** (ver dudas 2 a 5).

## Dudas abiertas para el backend

1. **`panelConfig` ya está en producción, pero `panelGuardarConfig` no.** Como estaba previsto, el panel bloquea esa escritura: Unidades y Técnicos y vehículos son de solo consulta hasta que llegue `panelGuardarConfig`. Lo mismo pasará con las parejas `panelCompras` ↔ `panelAsignarCombustible` / `panelClasificarProveedor` y `panelCostes` ↔ `panelCostesTecnico` si salen por separado.
2. **El vehículo de Gerencia (`9409LVM`, `brigada: "Gerencia"`) sale en «Vehículos sin asignar» y se puede meter en una brigada.** ¿Debe quedar fuera de las unidades? Si es así, ¿con qué dato lo distingo? Propuesta: un campo explícito, `vehiculos[].asignable: false`, antes que deducirlo del texto de `brigada`.
3. **`brigada` frente a `asignaciones`.** Las dos dicen en qué unidad está hoy el vehículo. El panel usa `asignaciones`, porque tienen vigencia, y muestra `brigada` solo como dato informativo. ¿`brigada` se calcula a partir de las asignaciones, o es un dato aparte que podría no coincidir? Si es aparte, ¿cuál manda?
4. **No hay composición registrada antes del 01/09/2026.** Al consultar un día anterior, las tres brigadas salen vacías. El panel avisa: «El servidor no tiene registrada ninguna composición antes del 01/09/2026». ¿Se va a cargar el histórico anterior, o ese es el punto de partida?
5. **Dos vehículos con `desde: null`** (`2690NKC` y `4299NGK`). El panel lo trata como «en servicio desde siempre». ¿Es correcto, o falta la fecha?

## Unidades no productivas (`unidades[].tipo`), anunciado y aún no publicado

Lo que hace el panel desde el 23/09/2026:
- **Mientras `panelConfig` no traiga `tipo`**, el panel marca U1 a U3 como `instalacion` y añade dos unidades de ejemplo: `NP-SAT` («SAT») y `NP-EST` («Estructura»), con `tipo: "no_productiva"` y la marca **«ejemplo»**. En cuanto el backend publique el campo, esto deja de hacerse solo.
- Las no productivas se pintan en una zona aparte, «No productivas», **sin `limites.tecnicosPorUnidad`**. Aceptan técnicos y vehículos igual que las brigadas.
- **Las unidades de ejemplo nunca se envían al backend.** Si un cambio toca una de ellas, el panel no guarda y lo explica.

Dudas:

6. **¿Qué roles puede recibir una unidad no productiva?** Hoy solo se asignan técnicos con rol `Instalador`, también en SAT y Estructura, tal como se pidió («igual que las demás»). Con esa regla, el técnico de rol SAT (E05) no se puede poner en la unidad SAT. ¿Deben las no productivas aceptar también los roles SAT y Gerencia?
7. **Identificadores y nombres** de las unidades SAT y Estructura cuando se publiquen. El panel no depende de ellos; es solo para cotejar.
8. **Alta de unidades:** ¿el formulario de «Nueva unidad» debe pedir el `tipo`? Hoy no lo envía.

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
