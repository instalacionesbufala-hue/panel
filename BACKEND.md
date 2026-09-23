# Contrato del backend — fuente de verdad

Lo mantiene el backend. **Si algo de aquí contradice a `DECISIONES.md`, manda este fichero.**
Última actualización: 23/09/2026 · backend **v3.20.12**.

## Cómo saber qué está disponible

`GET ?action=ping` → `{ ok, version, panel: true, accionesPanel: [ ... ] }`

- Usa en producción **solo** las acciones de `accionesPanel`; el resto, en modo demostración.
- Sustituye el conjunto fijo `EN_PRODUCCION` de `js/api.js` por esta lista, leída del ping.
  Así no hay que tocar el panel cada vez que el backend añada una acción.
- Mantén la comprobación de `panel: true` antes de cualquier POST.

## Disponible en producción

| Acción | Método | Petición | Respuesta |
|---|---|---|---|
| `ping` | GET y POST | — | `{ ok, version, panel, accionesPanel }` |
| `panelLogin` | POST | `payload={"accion":"panelLogin","clave":"…"}` | `{ ok, token, caduca }` · `{ ok:false, error }` · `{ ok:false, bloqueado:true }` |

## Respuestas a DECISIONES.md (23/09/2026)

1. **`ids` en las altas — aceptado.** La respuesta de `panelGuardarConfig` traerá `ids: { tecnicos: [...], unidades: [...] }`.
2. **Forma de `panelCostes` — aceptada** la lista plana propuesta: `{ ok, desde, hasta, costes: [ { mes, idTec, costeEmpresaMes, origen } ] }`.
3. **`tiposProveedor` — array de objetos `{ valor, etiqueta }`**, sin `sinClasificar`. Ejemplo: `{ "valor": "vehiculo", "etiqueta": "Vehículo" }`.
4. **Corrección:** el panel sí debe usar el `ping` (ver arriba).

## Reglas del backend que el panel debe conocer

- Una acción desconocida por POST se **rechaza**: `{ ok:false, rechazado:true, error }`. No se encola nada.
- Una petición sin datos se **descarta**. Nunca se convierte en cierre de obra.
- Toda escritura **repite `accion`** en la respuesta.
- Testigo caducado → `{ ok:false, codigo:"sesion" }`.
- Nunca se llama a producción con acciones que no estén en `accionesPanel`.

## Próximas acciones (todavía NO disponibles)

`panelConfig` (la siguiente) · `panelCompras` · `panelCostes` · `panelLiquidacion` · `panelGuardarConfig` · `panelAsignarCombustible` · `panelClasificarProveedor` · `panelCostesTecnico`.

`panelConfig` necesita antes crear en la hoja las tablas de técnicos, vehículos, unidades y asignaciones con vigencia. Se hará en la próxima entrega y aparecerá sola en `accionesPanel`.
