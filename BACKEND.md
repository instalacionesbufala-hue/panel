# Contrato del backend — fuente de verdad

Lo mantiene el backend. **Si algo de aquí contradice a `DECISIONES.md`, manda este fichero.**
Última actualización: 23/09/2026 · backend **v3.20.15** (`Panel_Config.gs` v1.1).

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
| `panelConfig` | GET | `?action=panelConfig&token=…` | ver abajo · sin testigo válido: `{ ok:false, codigo:"sesion" }` |

## `panelConfig` — formato real

Solo lectura: no escribe nada en la hoja. Devuelve siempre `accion: "panelConfig"`.

```json
{
  "ok": true,
  "accion": "panelConfig",
  "tecnicos": [
    { "id": "E02", "nombre": "Miguel Á. Nogales", "rol": "Instalador",
      "grupo": null, "alta": null, "baja": null, "activo": true }
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
  "ejercicio": { "anio": 2026, "jornadaAnual": 1770 }
}
```

### Reglas de este contrato

- **Los identificadores de unidad son los nombres de brigada de la hoja**, no códigos (`"Búfala 1"`, `"SAT"`, `"Gerencia"`). No son `U1`, `U2`… El panel debe tratarlos como cadenas opacas.
- **`nombre` es solo para mostrar y puede no coincidir con `id`.** Hoy la unidad `Gerencia` se presenta como **Estructura**. El identificador no cambia porque es lo que espera el motor de costes.
- **`tipo`**: `"productiva"` (brigadas de instalación) o `"no_productiva"` (SAT y Estructura).
- **`computaVariable: false` ⇒ esa unidad y sus técnicos quedan FUERA del cálculo del variable.** Vale para SAT (lo paga ESMOVE) y para Estructura/Gerencia. `panelLiquidacion` no devolverá filas suyas; el panel tampoco debe sumarlas si las recibiera.
- **`fechas` en `AAAA-MM-DD` o `null`.** `null` en `desde` = «desde siempre»; `null` en `hasta`/`baja` = vigente. `hasta` y `baja` son **inclusive**.
- **`grupo` llega siempre `null`.** El grupo profesional de convenio todavía no existe en la hoja de empleados; el `rol` (Instalador, Jefe, SAT, Gerencia) no es lo mismo y no se hace pasar por él. Pendiente de decidir.
- **`asignaciones` con `derivada: true`** son el vínculo vehículo→unidad deducido del recurso, no una fila escrita por nadie. Desaparecerán cuando `panelGuardarConfig` escriba la matrícula en la asignación.
- **`vehiculos[].sinMatricula: true`** significa que el recurso no tiene matrícula legible y se está usando su código interno como identificador. El panel puede mostrarlo, pero conviene avisar.
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

## Próximas acciones (todavía NO disponibles)

`panelGuardarConfig` (la siguiente) · `panelCompras` · `panelCostes` · `panelLiquidacion` · `panelAsignarCombustible` · `panelClasificarProveedor` · `panelCostesTecnico`.

Aviso para `panelGuardarConfig`, que escribirá en la misma tabla que usa el cálculo de costes: si los dos técnicos de una brigada cambian el mismo día, todas las filas abiertas de esa brigada pasarían a tener esa fecha de inicio y el alta efectiva de la brigada saltaría hacia delante, prorrateando su coste de estructura en rentabilidad, dashboard y KPI mensual. Se resuelve en el backend antes de publicar la acción; el panel no tiene que hacer nada.
