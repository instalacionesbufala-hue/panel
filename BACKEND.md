# Contrato del backend — fuente de verdad

Lo mantiene el backend. **Si algo de aquí contradice a `DECISIONES.md`, manda este fichero.**
Última actualización: 25/09/2026 · backend **v3.20.27** (`Panel_Config.gs` v1.4, `Panel_Compras.gs` v1.14, `Panel_Costes.gs` v1.2).

## Cómo saber qué está disponible

`GET ?action=ping` → `{ ok, version, ahora, dashGen, panel: true, accionesPanel: [ ... ] }`

- Usa en producción **solo** las acciones de `accionesPanel`; el resto, en modo demostración.
- Mantén la comprobación de `panel: true` antes de cualquier POST.
- Hoy la lista es `["panelLogin", "panelConfig", "panelCompras", "panelClasificarProveedor", "panelAsignarCombustible", "panelCostes", "panelCostesTecnico", "panelGuardarConfig"]`.

## Disponible en producción

| Acción | Método | Petición | Respuesta |
|---|---|---|---|
| `ping` | GET y POST | — | `{ ok, version, panel, accionesPanel }` |
| `panelLogin` | POST | `payload={"accion":"panelLogin","clave":"…"}` | `{ ok, token, caduca }` · `{ ok:false, error }` · `{ ok:false, bloqueado:true }` |
| `panelConfig` | GET | `?action=panelConfig&token=…` (opcional `&nocache=1`) | ver abajo · sin testigo válido: `{ ok:false, codigo:"sesion" }` |
| `panelCompras` | GET | `?action=panelCompras&mes=AAAA-MM&token=…` | ver «Compras» |
| `panelClasificarProveedor` | POST | `{ accion, proveedor, tipo }` | `{ ok, accion, filas, avisos }` |
| `panelAsignarCombustible` | POST | `{ accion, asignaciones: [{ idFactura, matricula \| null }] }` | `{ ok, accion, actualizadas, avisos }` |
| `panelCostes` | GET | `?action=panelCostes&desde=AAAA-MM&hasta=AAAA-MM&token=…` | ver «Costes» |
| `panelCostesTecnico` | POST | `{ accion, mes, costes: [{ idTec, costeEmpresaMes }], origen }` | `{ ok, accion, guardados, avisos }` |
| `panelGuardarConfig` | POST | `{ accion, asignaciones: [...] }` (solo asignaciones, ver abajo) | `{ ok, accion, filas, avisos, ids }` |

Todas las escrituras van por POST con el testigo en el campo `token` del formulario, como `panelLogin`. Sin testigo válido: `{ ok:false, accion, codigo:"sesion" }` y no se escribe nada.

## `panelConfig` — formato real

Solo lectura: no escribe nada en la hoja. Devuelve siempre `accion: "panelConfig"`.

```json
{
  "ok": true,
  "accion": "panelConfig",
  "tecnicos": [
    { "id": "E02", "nombre": "Miguel Á. Nogales", "rol": "Instalador",
      "grupo": "Oficial de 1ª", "alta": "2025-04-14", "baja": null, "activo": true }
  ],
  "vehiculos": [
    { "matricula": "2690NKC", "sinMatricula": false, "modelo": "Furgoneta B1",
      "rentingMes": 495.87, "brigada": "Búfala 1", "origen": "🚚 Recursos",
      "desde": null, "hasta": null, "activo": true },
    { "matricula": "9409LVM", "sinMatricula": false, "modelo": "Renting T-Cross",
      "rentingMes": 374.50, "brigada": "Gerencia", "origen": "⚙️ Configuración",
      "desde": "2026-06-01", "hasta": null, "activo": true }
  ],
  "unidades": [
    { "id": "Búfala 1", "nombre": "Búfala 1", "tipo": "productiva",
      "computaVariable": true, "activa": true },
    { "id": "Gerencia", "nombre": "Estructura", "tipo": "no_productiva",
      "computaVariable": false, "activa": true },
    { "id": "SAT", "nombre": "SAT", "tipo": "no_productiva",
      "computaVariable": false, "activa": true }
  ],
  "asignaciones": [
    { "idTec": "E02", "idUnidad": "Búfala 1", "matricula": null, "desde": null, "hasta": null },
    { "idTec": null, "idUnidad": "Búfala 1", "matricula": "2690NKC",
      "desde": null, "hasta": null, "derivada": true }
  ],
  "limites": { "tecnicosPorUnidad": 2 },
  "tramos": [],
  "ejercicio": { "anio": 2026, "jornadaAnual": 1770 },
  "cache": false
}
```

### Velocidad: encolad las peticiones

Medido en producción el 23/09/2026 desde el propio origen del panel:

| Llamada | Tiempo |
|---|---|
| `panelConfig` sola | 2,6 s |
| `ping` lanzado a la vez que otra llamada | 17,6 s |
| tres en paralelo | Google corta con su página de error |

**Apps Script serializa las ejecuciones del mismo script para un mismo usuario**: las llamadas en paralelo no van más rápido, se ponen en cola, y la última puede pasarse del tiempo que aguanta Google. No es la comprobación del testigo: con testigo inválido responde en 2,6 s.

Lo que toca a cada lado:

- **Backend (hecho, v3.20.18):** `panelConfig` se guarda en `CacheService` 10 minutos. La respuesta trae `cache: true` cuando viene de ahí. Se invalida sola cuando escriba `panelGuardarConfig`. Para forzar el recálculo: `&nocache=1`.
- **Panel (pendiente):** lanzar las peticiones al backend **de una en una**, no con `Promise.all`. Los sitios a revisar son `combustible.js` (`leerConfig` + dos `leerCompras` a la vez) y `costes.js` (`leerConfig` + `leerCostes`).

### Reglas de este contrato

- **Los identificadores de unidad son los nombres de brigada de la hoja**, no códigos (`"Búfala 1"`, `"SAT"`, `"Gerencia"`). No son `U1`, `U2`… El panel debe tratarlos como cadenas opacas.
- **`nombre` es solo para mostrar y puede no coincidir con `id`.** Hoy la unidad `Gerencia` se presenta como **Estructura**. El identificador no cambia porque es lo que espera el motor de costes.
- **`tipo`**: `"productiva"` (brigadas de instalación) o `"no_productiva"` (SAT y Estructura).
- **`computaVariable: false` ⇒ esa unidad y sus técnicos quedan FUERA del cálculo del variable.** Vale para SAT (lo paga ESMOVE) y para Estructura/Gerencia. `panelLiquidacion` no devolverá filas suyas; el panel tampoco debe sumarlas si las recibiera.
- **`fechas` en `AAAA-MM-DD` o `null`.** `null` en `desde` = «desde siempre»; `null` en `hasta`/`baja` = vigente. `hasta` y `baja` son **inclusive**.
- **`grupo` es el grupo de convenio** («Oficial de 1ª», «Peón (retribución de oficial de 2ª)»), distinto del `rol` (Instalador, Jefe, SAT, Gerencia). Puede llegar `null`: hoy lo hace en Gerencia, que está fuera de convenio. El panel debe tolerarlo.
- **`asignaciones` con `derivada: true`** son el vínculo vehículo→unidad deducido del recurso, no una fila escrita por nadie. Desaparecerán cuando `panelGuardarConfig` escriba la matrícula en la asignación.
- **`vehiculos[].sinMatricula: true`** significa que el recurso no tiene matrícula legible y se está usando su código interno como identificador. El panel puede mostrarlo, pero conviene avisar.
- **`vehiculos[].origen`** dice de qué pestaña sale cada vehículo. Las matrículas no se repiten: un vehículo que esté en las dos fuentes se publica una sola vez, con los datos de `🚚 Recursos`.
- **`tramos` va vacío** hasta que exista el motor de liquidación.
- **`jornadaAnual: 1770`** (Convenio del Metal de Madrid 2024–2027).

## Guardar asignaciones — `panelGuardarConfig`

**Solo asignaciones.** Mueve técnicos y furgonetas entre unidades con fecha. Lo que se guarda aquí es lo que usa el cálculo de costes reales por brigada, así que un cambio con fecha recalcula ese mes y los siguientes.

```json
{ "accion": "panelGuardarConfig",
  "asignaciones": [
    { "idTec": "E09", "idUnidad": "Búfala 1", "desde": "2026-10-01" },
    { "idTec": null, "idUnidad": "Búfala 3", "matricula": null,      "desde": "2026-10-01" },
    { "idTec": null, "idUnidad": "Búfala 2", "matricula": "7463LVN", "desde": "2026-10-01" }
  ] }
```

- **Técnico** `{ idTec, idUnidad | null, desde }`: se cierra su asignación abierta el día anterior a `desde` y se abre la nueva. `idUnidad: null` = sale de todas. Si la asignación abierta empieza el mismo día, se corrige en su sitio (sin duplicar).
- **Furgoneta** `{ idTec: null, idUnidad, matricula | null, desde }`: la unidad tiene esa furgoneta desde ese día (`null` = se queda sin furgoneta).
- **Si una unidad recibe una furgoneta y tenía otra que no se mueve en la misma petición, la anterior queda sin unidad** desde esa fecha, y la respuesta trae el aviso. Así nunca cuenta en dos sitios. Si el panel quiere llevarla a otra unidad, que mande también esa fila.
- **Todo se valida antes de escribir**: fecha, técnico, unidad y matrícula existentes, y un técnico solo una vez por petición. Si algo falla: `{ ok:false, error }` y **no se escribe nada**.
- **`tecnicos`, `vehiculos` o `unidades` no vacíos → `{ ok:false, rechazado:true, error }` y no se guarda nada**, tampoco las asignaciones que vinieran con ellos. Las altas y bajas todavía no están: el panel debe dejar esos botones desactivados o con «próximamente».
- **`avisos`** hay que enseñarlos siempre. Además del de la furgoneta sin unidad, puede venir uno sobre la Rentabilidad actual: si un cambio deja una brigada con todas sus asignaciones nuevas, el cálculo antiguo adelanta su alta y prorratea ese mes. Es informativo; la escritura se hace igual.
- Tras guardar, la caché de `panelConfig` se invalida sola.
- En `panelConfig`, la asignación `derivada` de una furgoneta (la que sale de `🚚 Recursos`) termina el día antes de su primer movimiento desde el panel. Las filas internas de «furgoneta sin unidad» no se publican.

## Compras — `panelCompras`

Sale de `💳 Compras Holded` (sincronizada con Holded cada noche, 180 días de histórico) y `🏷️ Proveedores`.

```json
{
  "ok": true, "accion": "panelCompras", "mes": "2026-09",
  "facturas": [
    { "id": "6ab3…", "fecha": "2026-09-01", "proveedor": "LEASYS S.P.A SUCURSAL EN ESPAÑA",
      "tipo": "vehiculo", "importeSinIva": 493.87, "matricula": "4299NGK", "numero": "L-902" },
    { "id": "6ab4…#0", "fecha": "2026-09-05",
      "proveedor": "ESPAÑOLA DE MOVILIDAD ELECTRICA SL. (ESMOVE) · Renting Peugeot Partner 7463LVN",
      "tipo": "vehiculo", "importeSinIva": 391.58, "matricula": "7463LVN", "numero": "E-77" }
  ],
  "sinClasificar": [
    { "id": "6ab5…", "fecha": "2026-09-09", "proveedor": "GASOLINERA NUEVA SL",
      "importeSinIva": 45.5, "esLinea": false }
  ],
  "tiposProveedor": [ { "valor": "combustible", "etiqueta": "Combustible" }, "…" ]
}
```

- **`id` es opaco.** Las facturas de proveedores `mixto` (ESMOVE, Amazon…) llegan **una fila por línea**, con `id` terminado en `#n` y `proveedor` = «PROVEEDOR · texto de la línea».
- **`sinClasificar[].esLinea: true`** → es una línea de un proveedor mixto, no un proveedor. Al clasificarla con `panelClasificarProveedor` el backend no da de alta un proveedor: guarda una **regla de línea** con ese texto. El panel manda lo mismo en los dos casos (`proveedor` tal cual llega); puede, si quiere, rotularlo distinto.
- **Las facturas de tipo `ignorar` no se envían.**
- **`importeSinIva`** es la base imponible: la Dirección trabaja sin IVA.

### Encargo para el panel (25/09/2026) — desplegable de vehículo en Combustible

Hoy el desplegable solo ofrece los vehículos **vigentes en el mes de la factura** (`vigenteEnMes(v.desde, v.hasta, mes)`), y en abril solo salen las dos Vivaro. Decisión de César:

- **Enseñar siempre las cuatro matrículas actuales** (`vehiculos` con `activo: true`), en cualquier mes, más las que ya tenga asignadas la factura.
- **Añadir la opción «Estructura (sin vehículo)»**, que se envía como `matricula: "ESTRUCTURA"`. El backend (v3.20.24) la acepta y la imputa a Estructura sin aviso de «sin matrícula». En `panelCompras` vuelve como `matricula: "ESTRUCTURA"`: el panel debe contarla como asignada y rotularla «Estructura».

### Clasificar factura a factura, con vista previa (25/09/2026, backend v3.20.27 · Panel_Compras v1.14)

Encargo de César: **para clasificar hay que ver la factura**, y **un mismo proveedor puede tener facturas de tipos distintos** (unas herramienta, otras material…). Además, hay facturas de **material de uso** que se reparten entre varios equipos.

**Acciones nuevas en producción:**

| Acción | Método | Petición | Respuesta |
|---|---|---|---|
| `panelFacturaDetalle` | GET | `id` (el `id` de la factura o línea; si lleva `#…` se usa el documento) | `{ ok, factura: { id, numero, proveedor, fecha, subtotal, total, notas }, lineas: [{ concepto, descripcion, unidades, precio, importe }], pdf: { base64, bytes, tipo } }` o `pdfError` si no hay PDF |
| `panelClasificarFactura` | POST | `{ id, tipo, equipos? }` | `{ ok, id, tipo, equipos, avisos }` · errores claros en `error` |

- `tipo` admite los de `tiposFactura` (en `panelCompras`): los de proveedor **sin `mixto`**, más **`materialUso`** («Material de uso (se reparte entre equipos)»).
- Con `tipo: "materialUso"` es obligatorio `equipos` (lista no vacía), con valores de **`equiposDisponibles`** (en `panelCompras`, hoy `["Búfala 1","Búfala 2","Búfala 3"]`). El importe se reparte **a partes iguales** entre los elegidos. César elige en cada factura.
- La clasificación queda marcada como **manual**: la sincronización nocturna ya no la pisa.
- Tras guardar, el backend recalcula los costes solo (como en las demás escrituras).

**Cambios en `panelCompras`:** cada factura trae `equipos` (lista) y `manual` (true si se clasificó a mano); cada sin clasificar trae `numero`; la respuesta trae `tiposFactura` y `equiposDisponibles`.

**Qué pide César en el panel:**
1. **Vista previa.** Cada factura sin clasificar (y cualquier factura, al pulsarla) abre un panel con el **PDF** (`data:application/pdf;base64,…` en un `<iframe>`/`<embed>`) y, si no hay PDF, la **tabla de líneas**. Al lado, los botones de clasificación, para decidir de un vistazo.
2. **Desagrupar por proveedor.** Hoy se clasifica el proveedor entero. Debe poderse clasificar **cada factura por separado** con `panelClasificarFactura`. Mantener la opción «aplicar a todo el proveedor» (`panelClasificarProveedor`) para cuando todas son iguales.
3. **Material de uso.** Al elegir «Material de uso» aparecen casillas con los `equiposDisponibles` (todas marcadas por defecto) y el reparto resultante («30,00 € a cada uno»). Sin ninguna marcada no se deja guardar.
4. **El contador de pendientes en azul**, no en rosa: el azul del panel (`--acento`, #3B5BF0).

### Aviso de facturas pendientes (25/09/2026, backend Panel_Compras v1.13)

`panelCompras` devuelve, además de lo del mes, un bloque **`pendientes`** con lo que falta por asignar **en todos los meses desde mayo de 2026** (inicio de la medición por equipo):

```json
"pendientes": {
  "desde": "2026-05",
  "sinAsignar": 14, "importeSinAsignar": 1135.40,
  "porMes": [ { "mes": "2026-05", "n": 6, "importeSinIva": 512.30 }, { "mes": "2026-07", "n": 8, "importeSinIva": 623.10 } ],
  "sinClasificar": 3,
  "sinClasificarPorMes": [ { "mes": "2026-08", "n": 3 } ]
}
```

- **`sinAsignar`** = facturas o líneas de tipo `combustible` o `vehiculo` **sin matrícula y sin «ESTRUCTURA»**. Una factura asignada a «Estructura (sin vehículo)» ya no cuenta.
- **`sinClasificar`** = facturas de proveedores aún sin clasificar.
- **Encargo de César:** que se vea **de un vistazo, en todo momento**, cuántas faltan. Por ejemplo, un contador en la pestaña «Combustible» del menú y un aviso arriba («Faltan 14 facturas por asignar matrícula o Estructura (1.135 €) · 3 sin clasificar»), con el desglose por mes para saltar a cada mes. Tras cada asignación, volver a pedir `panelCompras` para refrescarlo. Si `pendientes` llega `null`, no pintar nada.

### `panelAsignarCombustible` vale para cualquier gasto de vehículo

No solo combustible: también `vehiculo` (renting y mantenimiento). La matrícula tiene que existir en `vehiculos` de `panelConfig`; si no, se rechaza esa fila con un aviso y el resto se guarda. `matricula: null` quita el vehículo.

Los rentings se rellenan solos en el backend. La factura mensual de Leasys trae **las dos Opel Vivaro en un solo documento**: el backend lee su PDF y la **reparte en una fila por matrícula**, cada una con su importe (la original conserva su `id`; las demás llevan `id` terminado en `#mat:MATRÍCULA`). Solo reparte si los bloques suman exactamente la base de la factura. Las líneas de renting de las facturas de ESMOVE (Peugeot Partner y T-Cross) llevan la matrícula en el texto y se asignan igual. Para el panel son facturas normales: no tiene que hacer nada especial.

## Costes — `panelCostes`

Sale de `💰 Costes mensuales` (coste de empresa real por técnico y mes, de la nómina) y, donde no hay dato, del coste de referencia de `👤 Empleados`.

```json
{
  "ok": true, "accion": "panelCostes", "desde": "2026-06", "hasta": "2026-09",
  "costes": [
    { "mes": "2026-08", "idTec": "E01", "costeEmpresaMes": 2688.15, "origen": "gestoria" },
    { "mes": "2026-09", "idTec": "E01", "costeEmpresaMes": 2893.10, "origen": "estimacion" }
  ]
}
```

- **Una fila por técnico vigente en cada mes** (alta y baja inclusive). Un técnico dado de baja no aparece en los meses posteriores.
- **`origen`**: `"gestoria"` = dato de nómina; `"manual"` = corregido a mano; `"estimacion"` = no hay dato del mes y se usa el coste de referencia. `"estimacion"` nunca se guarda: es solo lectura.
- **`panelCostesTecnico`** acepta `origen` `"gestoria"` o `"manual"`. Crea o corrige el mes de cada técnico; un `idTec` que no exista se rechaza con aviso y el resto se guarda.
- Agosto 2026 ya está cargado con la nómina real (total 22.746,19 €).

## Reglas del backend que el panel debe conocer

- Una acción desconocida por POST se **rechaza**: `{ ok:false, rechazado:true, error }`. No se encola nada.
- Una petición sin datos se **descarta**. Nunca se convierte en cierre de obra.
- Toda escritura **repite `accion`** en la respuesta. Las lecturas también la repiten, pero el panel solo la exige en escrituras.
- Testigo caducado o ausente, en lectura y en escritura → `{ ok:false, codigo:"sesion" }`.
- Nunca se llama a producción con acciones que no estén en `accionesPanel`.

## Respuestas a DECISIONES.md (23/09/2026)

1. **`ids` en las altas — aceptado.** La respuesta de `panelGuardarConfig` traerá `ids: { tecnicos: [...], unidades: [...] }`.
2. **Forma de `panelCostes` — aceptada** la lista plana propuesta: `{ ok, desde, hasta, costes: [ { mes, idTec, costeEmpresaMes, origen } ] }`.
3. **`tiposProveedor` — array de objetos `{ valor, etiqueta }`**, sin `sinClasificar`.
4. **Corrección:** el panel sí debe usar el `ping`.
5. **Nuevo:** las unidades no son códigos correlativos. Cualquier suposición del panel sobre el formato de `idUnidad` (`U1`, `U2`…) hay que quitarla.

## Respuestas a las dudas abiertas (23/09/2026, tarde)

**1 · Cómo se envía el vehículo al guardar.** Vale el formato que propones, con un añadido: **manda la fila de vehículo siempre que cambie el vehículo**, aunque la unidad tenga técnicos y no se mueva ninguno. Deducirlo de las filas de los técnicos falla justo en ese caso, que es el más común: cambiar la furgoneta de una brigada sin tocar la gente. Resumen de lo que espera `panelGuardarConfig`:

- una fila por técnico que cambia: `{ idTec, idUnidad, matricula, desde }`;
- **más** una fila de unidad `{ idTec: null, idUnidad, matricula, desde }` cuando cambie el vehículo de esa unidad, tenga técnicos o no.

Enviar la fila de vehículo cuando no hacía falta no rompe nada: el backend la trata como idempotente.

**2 · Roles por unidad.** El `rol` **no restringe nada**. Sí, las no productivas reciben `SAT` y `Gerencia`, y sí, un `Jefe` va en una brigada (Iván Saucedo es jefe de equipo de Búfala 2). Quita el filtro que solo deja asignar `Instalador`: el panel puede avisar si algo parece raro, pero no debe impedirlo. Las combinaciones sensatas las decide quien usa el panel, no el código.

**3 · Alta de unidades.** El formulario manda `{ nombre, tipo }`. `computaVariable` **no lo manda el panel**: lo deriva el backend del nombre (las que casan con «Búfala N» son productivas). Si el nombre ya existe, el backend responde `{ ok:false, rechazado:true, error }` y no escribe nada, porque el identificador de una unidad **es** su nombre; conviene que el panel lo compruebe antes para no gastar el viaje.

**4 · `panelLiquidacion.filas[].unidad`.** Llega el **`id`**. Regla general de este contrato: todo campo que identifique algo lleva `id`; `nombre` existe solo para pintarlo en pantalla. Deja de comparar con los dos.

**5 · El BACKEND.md duplicado.** Fallo mío al subirlo: el commit metió el contenido nuevo dejando el viejo debajo. Corregido en el commit siguiente. Gracias por anotarlo.

## Próximas acciones (todavía NO disponibles)

`panelLiquidacion` (pendiente de que la Dirección fije las reglas del variable) · altas y bajas de técnicos, vehículos y unidades dentro de `panelGuardarConfig`.

Sobre el alta de brigada en la Rentabilidad actual: el riesgo sigue existiendo en el cálculo antiguo y ahora se avisa en la respuesta (ver `avisos`). Desaparece cuando Rentabilidad pase a leer los costes reales por brigada, que se reparten por días y no usan la fecha de alta.
