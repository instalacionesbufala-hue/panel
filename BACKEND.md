# Contrato del backend — fuente de verdad

Lo mantiene el backend. **Si algo de aquí contradice a `DECISIONES.md`, manda este fichero.**
Última actualización: 23/09/2026 · backend **v3.20.18** (`Panel_Config.gs` v1.3).

## Cómo saber qué está disponible

`GET ?action=ping` → `{ ok, version, ahora, dashGen, panel: true, accionesPanel: [ ... ] }`

- Usa en producción **solo** las acciones de `accionesPanel`; el resto, en modo demostración.
- Mantén la comprobación de `panel: true` antes de cualquier POST.
- Hoy la lista es `["panelLogin", "panelConfig"]`.

## Disponible en producción

| Acción | Método | Petición | Respuesta |
|---|---|---|---|
| `ping` | GET y POST | — | `{ ok, version, panel, accionesPanel }` |
| `panelLogin` | POST | `payload={"accion":"panelLogin","clave":"…"}` | `{ ok, token, caduca }` · `{ ok:false, error }` · `{ ok:false, bloqueado:true }` |
| `panelConfig` | GET | `?action=panelConfig&token=…` (opcional `&nocache=1`) | ver abajo · sin testigo válido: `{ ok:false, codigo:"sesion" }` |

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

`panelGuardarConfig` (la siguiente) · `panelCompras` · `panelCostes` · `panelLiquidacion` · `panelAsignarCombustible` · `panelClasificarProveedor` · `panelCostesTecnico`.

Aviso para `panelGuardarConfig`, que escribirá en la misma tabla que usa el cálculo de costes: si los dos técnicos de una brigada cambian el mismo día, todas las filas abiertas de esa brigada pasarían a tener esa fecha de inicio y el alta efectiva de la brigada saltaría hacia delante, prorrateando su coste de estructura en rentabilidad, dashboard y KPI mensual. Se resuelve en el backend antes de publicar la acción; el panel no tiene que hacer nada.
