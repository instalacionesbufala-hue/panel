# Decisiones y contrato acordado con el backend

Estado a 23/09/2026. Lo marcado como **acordado** lo ha confirmado el backend. Lo marcado como **por confirmar** es una suposición del panel que hay que validar cuando se implemente la acción.

## Qué va a producción

Solo las acciones del conjunto `EN_PRODUCCION` de `js/api.js`. Hoy solo `panelLogin`. El resto se sirve en **modo demostración**, con datos de ejemplo en memoria y la forma del contrato. Durante el desarrollo no se llama a producción con nada; las pruebas se hacen con la demostración y con `fetch` interceptado en el navegador.

En producción también existe `ping` (GET y POST), pero el panel no lo usa.

## 0. Incidente de la cola de cierres (cerrado)

El 22/09/2026, las pruebas de conexión enviaron 7 POST al backend v3.20.7, que los encoló como cierres de obra (`COLA_20260922_*_SIN_ID.json`). **Resuelto en el backend desde la v3.20.8:** las peticiones vacías y las acciones desconocidas se rechazan sin encolar nada. Los 7 ficheros ya se procesaron sin dejar efectos.

## 1. Sesión — acordado

- Acceso: `POST` con `payload={"accion":"panelLogin","clave":"…"}` → `{ ok, token, caduca }` o `{ ok:false, error }`. Tras 5 fallos, `bloqueado:true` durante 15 minutos.
- Escrituras: la acción va **dentro de `payload`** (`"accion": "…"`) y el testigo como campo `token` del formulario.
- Lecturas: `?action=…` y el testigo como `token` en la query.
- Testigo caducado → `{ ok:false, codigo:"sesion" }`. El panel pide la contraseña y repite la operación.
- Toda respuesta a una escritura repite `accion`. Si no la repite, el panel no da nada por guardado.

## 2. Asignaciones — acordado

- Al guardar, el panel envía una fila por técnico cuya unidad o vehículo cambia (`desde` = fecha de efecto, `hasta: null`). El backend cierra la anterior.
- Sacar a un técnico de su unidad: `{ idTec, idUnidad: null, matricula: null, desde }`.
- Unidad con vehículo y sin técnicos: `{ idTec: null, idUnidad, matricula, desde }`; para retirar ese vehículo, la misma fila con `matricula: null`.
- `hasta` es inclusive; igual `baja` de técnicos y `hasta` de vehículos.
- `panelConfig` envía `limites.tecnicosPorUnidad`. El panel lo aplica en el momento de soltar. Una unidad de un técnico es normal y no avisa.
- Sin correcciones retroactivas: los días pasados solo se consultan.

## 3. Unidades y bajas — acordado, con un cambio

- Unidad de baja: `{ id, activa:false, hasta }`. Técnico: `baja`. Vehículo: `hasta`. Nunca se borra nada.
- **Las altas se envían sin `id`: lo asigna el backend.** El panel ya no propone identificadores. Sí envía la matrícula de los vehículos, porque es su identificador natural.
- **Por confirmar:** cómo devuelve el backend los identificadores asignados. El panel lee `ids: { tecnicos: ["T07"], unidades: ["U4"] }` en la respuesta de `panelGuardarConfig` y los muestra en el aviso. Si llega con otro nombre, basta con cambiar una línea en `js/tecnicos.js`. Aunque no llegue, el alta funciona igual, porque la lista se vuelve a leer.

## 4. Costes — acordado

- Lectura: `GET ?action=panelCostes&desde=AAAA-MM&hasta=AAAA-MM`. Con una sola llamada salen el mes, el anterior (para las sugerencias) y el histórico de 6 meses. Ya no se usa la liquidación para esto.
- Coste real ⇔ `origen === "gestoria"`.
- **Por confirmar:** la forma de la respuesta. El panel espera una lista plana:
  ```json
  { "ok": true, "desde": "2026-03", "hasta": "2026-08",
    "costes": [ { "mes": "2026-08", "idTec": "T01", "costeEmpresaMes": 2579.29, "origen": "gestoria" } ] }
  ```
- El histórico marca cada mes como «coste real» si todos los técnicos activos lo tienen, o como «estimación (x de y reales)».
- CSV opcional: separador `;`, `,` o tabulador; identificador o nombre del técnico e importe. Nada se envía hasta pulsar «Guardar costes».

## 5. Combustible — acordado, con dos correcciones

- **Quitar el vehículo de una factura:** se envía `matricula: null`. En el desplegable aparece «— Quitar vehículo —».
- **Tipos de proveedor:** ya no están fijos en el código. Salen de `panelCompras.tiposProveedor`, sin `sinClasificar`, que no es una opción para elegir. Hoy son combustible, material, vehiculo, estructura, herramienta, mixto e ignorar.
- **Por confirmar:** el formato de `tiposProveedor`. El panel acepta texto (`"material"`) y muestra la primera letra en mayúscula («Vehiculo» sale sin tilde). También acepta objetos `{ "valor": "vehiculo", "etiqueta": "Vehículo" }`, que se verían mejor.

## 6. Otras decisiones — acordado

- JavaScript nativo, sin bibliotecas. El arrastre usa la API de HTML5, con un desplegable «Mover a…» como alternativa táctil.
- Borradores solo en memoria: no se guardan en el navegador porque incluyen importes salariales.
- El panel no calcula el variable: muestra lo que manda `panelLiquidacion`.
- Con `file://` los módulos no cargan; en GitHub Pages o con un servidor estático, sí.

## Pendiente

1. Backend: implementar `panelConfig`, `panelCompras`, `panelLiquidacion`, `panelCostes`, `panelGuardarConfig`, `panelAsignarCombustible`, `panelClasificarProveedor` y `panelCostesTecnico`.
2. Confirmar los tres puntos «por confirmar»: `ids` en las altas, la forma de `panelCostes` y el formato de `tiposProveedor`.
3. Pasar cada acción a `EN_PRODUCCION` cuando el backend la confirme, y probarla entonces.
