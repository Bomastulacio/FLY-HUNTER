# Entrega de implementación a Gemini

Fecha: 15/09/2026. Proyecto: Flight Hunter, repositorio existente.
Presupuesto del usuario: **gratis para uso personal**, sin abonos de datos o de ejecución LLM.
No hace falta releer toda la conversación ni volver a buscar decenas de herramientas.

## Prompt inicial para pegar en el IDE

```text
Trabajá sobre este repositorio Flight Hunter, conservando mis cambios locales de seguridad.
Quiero que funcione como monitor personal de vuelos ida y vuelta, con presupuesto US$0/mes.
Tu trabajo es implementar, probar y entregar incrementos utilizables, sin reescribir la app.

Leé primero agents.md, frontend/AGENTS.md y MONITORING.md. Luego leé RESEARCH_SOURCES.md
para las decisiones y los límites de las fuentes. La única secuencia de trabajo es
«Plan personal sin abono» F0–F5 en MONITORING.md. Empezá con F0 y F1. No implementes todas
las integraciones de la tabla: son alternativas evaluadas, muchas descartadas.

Conservá Astro/Vanilla CSS/Phosphor, Supabase Auth/RLS, Actions 09 y 21 UTC y LangGraph.
No agregues cron, servidores persistentes, otro orquestador ni agentes LLM. El pipeline
debe funcionar sin una API de modelo. Mi elección de modelo del IDE no cambia GEMINI_MODEL.

Antes de editar, inspeccioná git status/diff. Hay cambios anteriores pendientes y un borrador
shared/personalCapture.ts sin integrar ni probar: no lo declares terminado. Respetá permisos
administrativos y nunca expongas service role o ADMIN_TOKEN. Usá los skills locales pertinentes.

El primer incremento útil es captura personal: extensión local de lectura iniciada por el
usuario -> archivo JSON mínimo -> /capturas con revisión y resumen en vivo -> saved_deals
privado con fuente manual_capture. No escribir flight_deals desde una captura ni activar
seguimiento automático o correos de oro. No guardar cookies, tokens, HTML completo ni PII.
Despegar/Aerolíneas: campos visibles y revisión; Turismocity: carga manual. Los campos
desconocidos quedan sin confirmar; no calcular un total sumando precios por tramo.

Después completá la verificación del regreso y prioridades dentro del presupuesto existente.
SerpApi ya existe en Python: 2 intentos por corrida, 4 por día, 220 por ciclo con reserva;
Google 4 por corrida/8 diarios, Despegar 2/4. No ampliar. Reservar antes de cada paso externo.
403/429/CAPTCHA pausa la fuente. Nunca conectar varias librerías para evitar esa pausa.

fli (paquete flights), fast-flights y swoop son alternativas de acceso a Google, no inventarios
independientes. Primero pruebas offline; evaluar solo una alternativa activa. Desactivar
reintentos/búsquedas ocultas y servicios pagos de terceros. Si no mejora o no permite
contabilizar I/O, descartar. No hace falta un MCP en el cron; usar contrato de adaptador.

Conservá máximo una escala en cada sentido, exclusiones, pasajeros exactos, precio total
sin duplicar multiplicación, fecha de observación, condición de pago e identidad comparable.
No promover precio de búsqueda inicial a itinerario completo. No generar datos ficticios
en producción para completar cards. Una web abierta o un JSON válido no prueba disponibilidad.

Para cada fase: implementá el flujo entero, corré pruebas relevantes sin proveedores vivos
ni LLMs, resumí archivos cambiados, evidencia y límites. TypeScript/Chromium offline/PGlite,
build Astro y evals Python cuando cambies Python. Una prueba en vivo es posterior, acotada
y presupuestada, separada de los tests. No hagas compras ni envíes mensajes externos.
Al terminar los cambios probados, preguntame por commit/push según agents.md.
```

## Forma de trabajar para ahorrar contexto y tokens

Una fase por turno largo. La entrega de cada fase debe tener: resultado, archivos tocados,
comandos y resultados de pruebas, pendientes reales y siguiente fase. Si se corta el contexto,
retomar desde ese resumen y el diff, sin reinterpretar la arquitectura. No repetir búsqueda
web salvo que haya cambiado un proveedor o falte un dato necesario para implementar.

Prompts de continuación, después de revisar el incremento anterior:

```text
Continuá con F2 de MONITORING.md. Conservá lo implementado en F1 y la cuota actual.
Probá el regreso, los filtros duros y que los resultados parciales no generen oro.
```

```text
Continuá con F3 de MONITORING.md. Hacé evaluación offline antes de activar un candidato.
No instales los tres ni modifiques cuotas. Entregá evidencia para elegir o descartar.
```

```text
Continuá con F4 de MONITORING.md y cerrá la verificación completa del flujo. F5 es opcional;
no bloquees lo útil esperando contratos ni conviertas un cupo de prueba en gasto recurrente.
```

## Archivos que orientan la implementación

| Responsabilidad | Archivos existentes |
|---|---|
| Plan, foco, límites, resultados | `agent/src/index.ts`, `agent/src/agent/searchPlanner.ts`, `agent/src/agent/searchRuntime.ts` |
| Contrato y reglas de cotización | `agent/src/types/flight.ts`, `agent/src/agent/quotePolicy.ts`, `agent/src/skills/quoteParser.ts` |
| Google y Despegar actuales | `agent/src/skills/googleFlights.ts` si existe; descubrir nombre real con `rg --files agent/src/skills`; `agent/src/skills/despegar.ts` |
| Seguimiento | `agent/src/agent/monitoring.ts`, `frontend/src/utils/monitoringView.ts` |
| Cards y feed | `frontend/src/utils/compactFlights.ts`, `frontend/src/utils/latestQuotes.ts`, `frontend/src/pages/index.astro` |
| Base/Auth | `schema.sql`, `schema_quote_evidence.sql`, `schema_monitoring.sql`, `frontend/src/lib/supabase.ts` |
| Seguridad administrativa | `frontend/src/pages/api/anomaly-action.ts`, `agent/tests/anomaly-authorization.test.ts` |
| Python y API de respaldo | `backend/src/graph.py`, `backend/src/agents/collectors.py`, `backend/src/services/search_budget.py` |
| Dependencias y runtime | `backend/requirements.txt`, `agent/package.json`, `.github/workflows/agent-hunt.yml`, `.github/workflows/pipeline.yml` |
| Borrador de captura | `shared/personalCapture.ts`: sin consumidores ni pruebas; no es una funcionalidad terminada |

El esquema local declara los guardados personales y su RLS; no se verificó acceso al Supabase
remoto en esta investigación. No aplicar SQL ni reasignar roles de cuenta por inferencia.
F1 puede reutilizar el esquema; solo proponer migración si una limitación comprobada la exige.

## Qué NO se ha entregado todavía

No hay extensión instalable, página /capturas, nuevo adaptador activado ni benchmark vivo de
fli/fast-flights/swoop. No se comprobó un inventario autónomo de Aerolíneas desde Actions.
La investigación no instaló MCP nuevos ni obtuvo credenciales externas. La documentación
no cuenta como despliegue. Las pruebas exitosas anteriores no validan funcionalidades futuras.
