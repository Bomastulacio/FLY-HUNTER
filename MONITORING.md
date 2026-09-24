# Monitoreo personal y primeras cuentas

## Alcance implementado

Este documento y `agents.md` son la referencia de operación. Se conserva el diseño actual,
los filtros duros y el loop acotado del Crítico. No hay un segundo planificador LLM ni un
cron nuevo. La fase actual prioriza que funcione para el propietario y pocas cuentas.

Flujo: radar activo → alternar explorar/seguir → adaptador presupuestado → verificar datos →
registrar observación de guardados → evaluar elegibilidad del feed → persistir → grafo Python
existente → notificaciones existentes. Una observación de precio alto no implica aprobación.

### Explorar y seguir

- Dos corridas: 09:00 y 21:00 UTC; en Argentina 06:00 y 18:00. Ambos contadores de la UI usan
  `searchSchedule.ts`. Un test compara esas horas con el YAML del workflow.
- Se aprovechan los topes existentes: Google 4 / Despegar 2 por corrida, máximos diarios 8 / 4.
  El bucle anterior hacía solo dos pasadas; ahora puede utilizar capacidad disponible alternando
  exploración y seguimiento. No se amplían límites de proveedor ni de SerpApi.
- El workflow guarda cursores, consumo y pausas aunque falle un paso posterior del job.
  No depender del guardado de caché solo al finalizar con éxito. Ver
  [patrón oficial de guardado ante fallos](https://github.com/actions/cache/tree/main/save#always-save-cache).
  Una pérdida completa del runner o la expulsión de caché todavía requiere el contador durable
  en Postgres previsto para escalar; no se promete durabilidad absoluta con Actions Cache.
- Explorar recorre el espacio de fechas con cursor determinista; seguir revisa combinaciones
  guardadas. Si un guardado ya se revisó en esa corrida, se vuelve a explorar.
- Se rotan radares entre corridas y se comparten consultas con mismos parámetros. Las diferentes
  exclusiones/escalas/pasajeros siguen formando parte de la clave; nunca mezclar cotizaciones.
- Solo se siguen guardados pertenecientes al dueño de un radar activo y dentro de sus parámetros.
  Cambiar fechas, pasajeros o exclusiones puede sacarlos de seguimiento sin borrar su historial.
  Borrar un guardado detiene su seguimiento; no lanza un cron. Se sigue su fuente original;
  SerpApi se agrupa con Google, no se usa para crear búsquedas pagas desde un guardado.
- Guardados sin identificador completo de vuelo/familia tarifaria se tratan como combinaciones
  comparables de ruta, fechas, pasajeros, aerolínea, escalas y pago. No hay garantía de mismo
  horario, equipaje o tarifa. Un resultado Google de ida no verifica las escalas del regreso.
- `radar_scan_status` muestra combinaciones únicas verificadas en las 24 h anteriores al estado
  registrado / tamaño total de ventana. `ok` y `empty` cuentan; bloqueos, errores y resultados
  no verificables no cuentan. Hits de caché conservan fecha original. Cobertura parcial no es
  "sin vuelos" ni una revisión completa de la ventana.

### Datos y responsabilidades

| Recurso | Uso | Escritura |
|---|---|---|
| `search_alerts` | Parámetros vigentes del usuario | Dueño con Auth/RLS |
| `flight_deals` | Feed reciente; conserva aprobación/notificación | Pipeline existente |
| `saved_deals` | Cotización original elegida por el usuario | Dueño con Auth/RLS |
| `saved_deal_checks` | Historial de verificaciones, con clave de evento idempotente | Service role |
| `saved_deal_latest` | Última consulta y última observación válida, vista `security_invoker` | Solo lectura |
| `radar_scan_status` | Estado por radar/fuente y cobertura parcial | Service role |
| `radar_preferences` | Radar principal sincronizado | Dueño con Auth/RLS |

El precio guardado no se reemplaza automáticamente. Se registran también subas. Un `blocked`,
`error`, `unverified` o `not_observed` no significa vuelo agotado: se conserva el último precio
observado con un estado explícito. El historial de monitoreo guarda JSON normalizado, nunca
credenciales, HTML completo ni respuestas de sesión.

El feed y la caché que consume Python eligen la observación más reciente de cada combinación
comparable antes de filtrar por presupuesto. Una suba no deja ganando el precio barato anterior.
Las cotizaciones verificadas fuera del presupuesto también se persisten como `no_aplica`, con
`detalle_cotizacion.budgetScope = 'radar'`: cada radar vuelve a aplicar sus propios límites.
No se convierten en rechazos globales para cuentas con otro presupuesto. Los rechazos humanos
y las aprobaciones pendientes se respetan; los datos que fallan los filtros duros no se publican.

Las nuevas tablas privadas revocan privilegios anónimos. Los clientes solo leen sus observaciones
y sus estados, sin poder falsificarlos. Las preferencias validan que el radar pertenece al usuario.
Los tests SQL incluyen otra cuenta, anónimo, service role y una segunda aplicación del script.

### App y avisos

- Se conserva el diseño de cards. En Guardados aparecen el precio original y la última observación.
- La app sincroniza snapshots de la base al abrir, al volver al foco (mínimo 60 s) y cada 120 s
  mientras está visible. No llama proveedores ni LLMs. Preserva el detalle abierto y evita
  reemplazar un guardado durante una operación del usuario.
- Una baja de al menos US$50 y 5% produce un toast dentro de la app. El navegador recuerda el
  último precio avisado por guardado para no repetirlo; no se avisa sobre datos de más de 24 h.
- Los emails actuales de oro/anomalías mantienen el flujo Python existente. Esta fase NO agrega
  push con la app cerrada ni un segundo emisor de mails; evitar duplicar notificaciones.
- El principal se guarda por cuenta; una preferencia local previa válida se migra al iniciar sesión.
  No modifica cuota/prioridad operativa. Si el esquema no está disponible, se conserva su lectura local
  y un cambio que no se pudo sincronizar informa error.

## Instalación / despliegue

1. Aplicar `schema_quote_evidence.sql` si aún no se aplicó. Luego `schema_monitoring.sql` sobre la
   base del proyecto. Para una instalación nueva: `schema.sql` y `schema_monitoring.sql`.
   El repositorio usa scripts SQL manuales; no introducir otra historia de migraciones en paralelo.
2. Verificar con una cuenta de prueba que puede leer sus guardados y preferencias y que no ve
   los de otra cuenta. El script se verifica offline en PGlite, no equivale a probar el proyecto remoto.
3. Publicar código y workflows solo tras aprobación de push. El agente comprueba las tablas antes
   de consultar proveedores: si falta el esquema, falla sin gastar búsquedas.
4. Ejecutar una corrida normal respetando cuota/cooldowns. Revisar estado por fuente, una observación
   real de un guardado y su reflejo en la app. No limpiar cachés para forzar consultas.

Esta implementación no aplica automáticamente SQL a producción ni crea suscripciones externas.
Las tablas son aditivas; no eliminan datos del feed ni cambian estados humanos de aprobación.

Para aprobar/rechazar anomalías globales desde la web, la cuenta autenticada debe tener
`app_metadata.flight_hunter_admin = true`, asignado por un administrador mediante Supabase Auth
del servidor. Nunca usar `user_metadata` ni distribuir `ADMIN_TOKEN` al navegador. Los llamadores
backend autenticados pueden conservar `X-Admin-Token`; las cuentas comunes reciben 403. La acción
solo modifica filas pendientes y devuelve 409 si otra revisión ya las resolvió. No se asignaron
privilegios a cuentas remotas durante la auditoría.

## Verificación

- `cd agent` → `npm run check` y `npm test`: filtros anteriores, parser Google/Despegar con
  fixtures sin red, presupuesto/cache, seguimiento, UI proyectada, cron y SQL/RLS real en PGlite.
- `cd frontend` → `npm run build`.
- Las cards se prueban offline con el CSS real en Chromium a 360, 390, 768 y 1280 px:
  apertura del detalle, precio original/actual, áreas táctiles y ausencia de desborde horizontal.
  Esto no sustituye una prueba en dispositivos iOS/Android físicos ni la integración con Supabase remoto.
- Python: `python -B evals/test_search_orchestration.py` y `python -B evals/test_critic_decisions.py`
  cuando se cambia ese motor. Mantener la brecha ya documentada del refinamiento vacío.
- No usar los tests como excusa para consultar SerpApi/Gemini o proveedores en vivo.

Validación local del 13/09/2026: 22 tests TypeScript, 10 tests Python de orquestación,
TypeScript check, compilación Astro y sintaxis YAML aprobados. La prueba interactiva completa
con cuenta real queda pendiente: el entorno local no tiene `SUPABASE_URL` configurada y el
SQL nuevo no se aplicó al proyecto remoto. Las pruebas de cards y RLS usan datos sintéticos;
no se consumieron búsquedas de proveedores ni llamadas Gemini en esta validación.

## Próximas etapas (no implementadas aún)

### Estudio de UX del 24/09/2026

Se preparó un prototipo local independiente en `design/prototype/`, abierto con
`node evals/preview_concept.mjs` (puerto 4323). Incluye cards glass, país ganador y país
fijado, guardados en memoria, edición de fechas/noches/precio objetivo y estados de ejemplo.
No está integrado a la app ni conectado a datos o correos. Los precios son demostrativos.
Antes de integrar, validar la propuesta visual con el usuario y conservar las etapas de
fiabilidad siguientes. País fijado no implica mayor cuota; umbral personal y noches aún
requieren implementación persistente y verificación de extremo a extremo.

### Plan personal sin abono — decisión del 15/09/2026

El usuario confirmó presupuesto **US$0/mes** y pidió investigación/arquitectura para implementar
con Gemini. `RESEARCH_SOURCES.md` documenta fuentes, límites y diseño; `GEMINI_HANDOFF.md`
es el prompt de ejecución. Esta sección es la única secuencia de trabajo. Priorizar F0–F3
antes de push móvil, widgets y expansión. No se autorizó cambiar cron, cuotas ni contratar APIs.

**F0. Establecer la línea de base y conservar seguridad.**
Inspeccionar git status/diff y no pisar cambios del usuario. Revisar `agent/src/index.ts`,
`agent/src/agent/searchRuntime.ts`, `backend/src/agents/collectors.py`, ambos workflows y
`frontend/src/pages/api/anomaly-action.ts`. Identificar esquema remoto disponible sin asumir
que un archivo SQL ya se aplicó. Correr suites offline existentes y documentar la brecha
`expectedFailure`. La auditoría anterior aprobó 36 pruebas TS, 13 Python de orquestación y
22 del Crítico con una limitación esperada; no es validación de código que se agregue después.
Salida: resumen corto de qué está activo, pendiente de despliegue y no implementado.

**F1. Completar captura personal, extremo a extremo.**
Revisar el borrador `shared/personalCapture.ts`, todavía sin consumidores ni tests. Crear una
extensión local Chrome/Edge con permisos mínimos `activeTab`/`scripting`, captura solo por
acción del usuario y exportación de JSON normalizado. Lectura de Despegar visible y del
resumen seleccionado de Aerolíneas; Turismocity por carga manual. Crear `/capturas` con
importación por archivo y formulario revisable, resumen en vivo, validación y confirmación
del usuario antes de guardar. Sin campos inventados si faltan fechas, regreso, USD o pasajeros.
Reutilizar `saved_deals`/Auth/RLS, fuente `manual_capture`, sin service role ni inserción en
`flight_deals`. No sobrescribir guardados ante conflicto. Mantener consulta original y hora.
Actualizar `compactFlights.ts` y `monitoringView.ts` para identificar capturas y declarar
ausencia de seguimiento automático. Excluirlas explícitamente del plan/avisos; probarlo.
Acceso a capturas aun sin radar creado; entrada visible desde navegación/Guardados.
Entregar carpeta instalable + ZIP reproducible e instrucciones de instalación. Aceptación:
capturar fixture → importar → revisar → guardar → recargar → mostrar → eliminar con Auth/RLS
simulados; usuario B/anónimo no acceden, XSS/URLs externas/cookies no entran en el payload.

**F2. Concentrar cobertura y verificar el regreso.**
Mantener `searchPlanner.ts` y el reparto determinista; agregar preferencia opcional de un
conjunto pequeño de combinaciones prioritarias dentro del radar. No inferir aeropuertos ni
fechas nuevas sin el usuario; no ampliar consumo. Mostrar cobertura real y causas de omisión.
SerpApi sigue siendo respaldo Python: separar resultado inicial de itinerario completo y
presupuestar los pasos de regreso/booking. Si no queda cuota, conservar un resultado parcial
etiquetado o dejar verificación pendiente; no afirmar máximo una escala del regreso sin datos.
Evitar que una cotización parcial genere oro. Tests de rutas/fechas/pax/exclusiones y estados;
probar que abrir la app, guardar o editar presupuesto no consulta proveedores.

**F3. Evaluar un extractor abierto sin activar tres motores.**
Primero revisar versiones/licencias/transporte de `fli` (`flights`, ya declarado) y luego
`fast-flights` si el primero no cumple. `swoop` queda tercero. Crear un harness offline con
contrato común y fixtures del proyecto. Elegir uno solo si controla reintentos y pasos de I/O,
produce evidencia válida para dos adultos/ida y vuelta/USD y mejora al adaptador existente.
Una evaluación en vivo posterior respeta topes, pausas y reservas; no activar consultando desde
un MCP sin ledger. Si gana uno, añadir adaptador intercambiable y apagado por defecto hasta
esa validación. Fijar versión/commit, mantener `inventory=google_flights` y registrar adapter;
no crear cuota ni fuente independiente por nombre de librería. No introducir servidor local,
cron, VPN, proxy, CAPTCHA solver ni fallback pago. Si ninguno supera la prueba, documentar
el descarte y conservar el actual. Aceptación: resultados y consumo comparables, rollback simple.

**F4. Operación gratuita y diagnóstico.**
Medir por corrida intentos, observaciones válidas/completas, bloqueos, omisiones y cobertura.
Mantener ejecución útil sin clave Gemini y revisar la variable `GEMINI_MODEL` del workflow
Python si se quieren explicaciones. No configurar automáticamente modelos por su etiqueta
en el IDE. No prometer horario exacto de Actions. Antes de múltiples ejecutores, realizar
la migración atómica de reservas/leases de la etapa de escalado. No confundir un job verde
con cotizaciones nuevas. Probar configuración de cuota ausente/agotada y esquema faltante.

**F5. Opcionales, posteriores a un flujo comprobado.**
OurAirports para catálogo geográfico versionado. Aviasales Data API solo si la cuenta obtiene
acceso y entrega pistas útiles para Argentina; separar caché orientativa de precio verificable.
Explorar acuerdos de Despegar/Turismocity si ofrecen acceso sin abono. No depender de
aprobaciones de partners, créditos de prueba o ventas futuras para terminar F1–F4.

Cada fase termina con tests relevantes, cambios documentados y límites explícitos. No mandar
emails reales en pruebas ni hacer compras. Commit/push requiere la confirmación establecida
en `agents.md`; no confundir el permiso para desarrollar con permiso para publicar.

### Etapas de expansión conservadas

Auditoría operativa del 14/09/2026: ver `SEARCH_RELIABILITY.md` para corridas reales que
demuestran bloqueo de Despegar en EZE–MAD 18/04–01/05 para dos adultos, cobertura de ejemplo
y evaluación de Turismocity/Aerolíneas. La planificación ahora reparte países/fechas al empezar;
editar presupuesto no reinicia cursores. Los motivos de omisión se distinguen en logs/resumen
y las pausas nuevas conservan su fecha original. También se conserva el ledger Python con
`cache/save` ante fallos posteriores. No se agregan fuentes automáticas ni se amplían cuotas.

1. Push opt-in para web instalada y avisos con app cerrada: suscripciones por usuario/dispositivo,
   cola transaccional, deduplicación común con emails y bajas configurables. Requiere provisionar
   claves VAPID y permisos del usuario; no simular push con `setInterval` en segundo plano.
2. Widgets iOS (WidgetKit) / Android: clientes del mismo snapshot privado, sin scraping. Elegir
   radar/favoritos y mostrar precio + fecha. Hay que crear los proyectos móviles, firmarlos e
   instalarlos; el manifiesto web actual no implementa widgets nativos. El SO decide la frecuencia
   efectiva de refresco. No reescribir Astro para empezar esta etapa.
3. Escalado: mover reservas de cuota, cursores y leases desde caché de Actions a Postgres con
   operaciones atómicas antes de añadir runners. Deduplicar búsquedas entre usuarios, definir
   reparto justo por cuenta, paginar el feed más allá de 500 filas recientes y retención del historial.
   La serialización actual y las cachés son adecuadas solo para las corridas controladas actuales;
   una caché perdida no es un contador global durable.
4. Ampliar cobertura con APIs/contratos autorizados según costo. Identidad completa del itinerario,
   equipaje, condiciones y selección de regreso antes de prometer repricing del mismo ticket.

No incorporar RAG de precios como fuente de disponibilidad. Las preferencias y observaciones
pertenecen a tablas consultables. Gemini puede explicar o priorizar datos verificados dentro del
presupuesto, nunca inventarlos ni autorizar más búsquedas.
