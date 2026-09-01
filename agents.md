# Flight Hunter — Prompt de Proyecto para Antigravity

1. Objetivo del proyecto
Construir una aplicación que busca proactivamente, filtra y notifica las mejores combinaciones de vuelos ida y vuelta (o multidestino/open-jaw) desde Buenos Aires (EZE/AEP) hacia Europa, para 2 personas, dentro de un presupuesto total de $1700–$2400 USD. Incluye un módulo secundario de monitoreo de vuelos a Japón (Tokio/Osaka), y un tracking especial de vuelos operados por Lufthansa.

Ventanas de fecha:
Ida: 17 al 19 de abril de 2027
Vuelta: 26 de abril al 1–2 de mayo de 2027

Regla de alerta crítica ("oportunidad de oro"): cualquier tarifa por debajo de ~$1500 USD dispara notificación inmediata, sin pasar por los filtros secundarios.
Regla de anomalía (requiere aprobación manual): ofertas muy atractivas que rompen levemente los parámetros (ej. salida el 16/4 en vez de 17–19/4) no se descartan ni se aceptan solas — quedan pendientes de aprobación humana antes de continuar el ciclo.

2. Arquitectura de ejecución (definición cerrada)
No usar Vercel Functions ni un servidor persistente para correr el pipeline. Usar GitHub Actions con schedule (cron) como motor de ejecución periódica del grafo LangGraph. Motivo: es gratuito, no requiere mantener infraestructura corriendo, y los jobs soportan hasta 6 horas de ejecución (de sobra para los loops de reflexión del Crítico).

El workflow corre cada 6 horas (para evitar rate-limits agresivos de la API de vuelos).
Además del schedule, el workflow debe aceptar:
- workflow_dispatch (para poder ejecutarlo manualmente desde la UI de GitHub cuando quieras forzar una corrida)
- repository_dispatch con tipo resume-after-approval (para retomar el ciclo automáticamente cuando se aprueba una anomalía desde la web)

Vercel se usa solo para:
- Servir el frontend Astro (el Bento Grid).
- Un endpoint API (/api/aprobar-anomalia) que recibe el click de Aprobar/Rechazar desde la web, actualiza Supabase, y dispara el repository_dispatch hacia GitHub Actions.

3. Stack tecnológico (definitivo)
Orquestación: Python + LangGraph + Pandas.
Datos de vuelos: SerpApi (Google Flights API). Fuente estructurada y confiable. Se requiere configurar la variable de entorno SERPAPI_KEY.
Envolver cada búsqueda en try/except con reintentos + backoff (2-3 reintentos, pausa de unos segundos) — confirmado en pruebas: un 403 no es necesariamente error de código, puede ser rate-limit puntual.
Filtrar resultados con flight.price_unknown — Google no siempre expone precio agregado por fila; esas filas no sirven para comparar contra presupuesto.

Base de datos: Supabase (Postgres), con service_role_key para escritura desde el pipeline y anon_key con RLS de solo lectura para el frontend.

Frontend: Astro. El grid necesita datos que cambian entre corridas del pipeline — no puede ser 100% estático (SSG puro). Usar SSR/ISR en Vercel o componente cliente que consulta Supabase directamente en onMount.

Notificaciones: Resend (o similar) para email transaccional. Mantenerlo simple.

Despliegue: Vercel (frontend + endpoint de aprobación) + GitHub Actions (pipeline).
IDE / meta-desarrollo: Antigravity, con este archivo como agents.md.

4. Esquema de datos en Supabase
Ver `schema.sql`.
hash_dedupe con constraint unique es lo que evita insertar la misma oferta dos veces entre corridas — usar on conflict do nothing.

5. Flujo del grafo (LangGraph)
Nodos:
Supervisor: recibe el goal (fechas, presupuesto, destinos), delega en paralelo a los subagentes recolectores.
Subagente Europa: consulta rutas hacia/desde Madrid, París, Londres.
Subagente Asia: consulta rutas hacia Tokio/Osaka.
Subagente Capricho: filtra específicamente disponibilidad Lufthansa.
Agente Analista (Pandas): consolida los JSON de los recolectores, calcula precio total para 2 pasajeros, normaliza rutas.
Agente Crítico: 
- Si la oferta cumple presupuesto y ventana de fechas → aprueba, marca para insertar.
- Si el precio está por debajo del umbral crítico → marca es_oportunidad_oro = true.
- Si rompe algún parámetro (fecha, escalas) pero es muy atractiva → marca es_anomalia = true, estado_aprobacion = 'pendiente'.
Nodo de persistencia: hace upsert en flight_deals con on conflict (hash_dedupe) do nothing.
Nodo de notificación: 
- Si hay filas nuevas con es_oportunidad_oro = true y notificado = false → manda email inmediato vía Resend, marca notificado = true.
- Si hay filas nuevas con estado_aprobacion = 'pendiente' → manda email "tenés una anomalía para revisar" con link a la app.
Fin del run. 

6. Frontend — Bento Grid
Estructura de cards:
Card principal: vuelo más barato absoluto a Europa.
Cards por destino: España / Francia / Reino Unido.
Card Lufthansa.
Bloque "Pendientes de aprobación" (anomalías con estado_aprobacion = 'pendiente') con botones Aprobar/Rechazar.
Sección Asia al final.

Diseño visual: no generar estilos genéricos. Usar los skills de diseño web del repo proporcionado (taste-skill).

7. Variables de entorno / secrets necesarios
GitHub Actions (secrets del repo):
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
RESEND_API_KEY, ALERT_EMAIL_TO
GH_DISPATCH_TOKEN, SERPAPI_KEY

Vercel (env vars del proyecto):
SUPABASE_URL, SUPABASE_ANON_KEY (frontend, solo lectura)
SUPABASE_SERVICE_ROLE_KEY (solo en el endpoint API, no exponer al cliente)
GH_DISPATCH_TOKEN, GH_REPO (para el endpoint de aprobación)
ADMIN_TOKEN (password para aprobar/rechazar desde la web)

### 8. Reglas Críticas Aprendidas (Post-Mortem)
Para evitar deuda técnica y bugs recurrentes, respetar obligatoriamente:

1. **Consultas Históricas (UI vs DB)**: Supabase retiene el historial completo de vuelos (los `upsert` generan nuevas filas si cambia la fecha). El frontend (`index.astro`) **siempre** debe filtrar los queries por `created_at` (ej. últimas 24 horas) para que los vuelos antiguos y baratos no dominen eternamente la interfaz.
2. **Tolerancia Cero en Escalas**: La regla de negocio es estricta: **Máximo 1 escala**. Cualquier vuelo con 2 o más escalas debe ser rechazado al inicio del Crítico (regla de early return), sin importar si el precio entra en la categoría de "Anomalía" u "Oportunidad de Oro".
3. **Evaluación de Límites**: Las constantes de límites (ej. `BUDGET_MIN`) no deben ser solo declarativas. Deben formar parte activa de las condiciones (ej. `BUDGET_MIN <= precio`).
4. **Protección de Endpoints Manuales**: Todo endpoint del frontend que dispare acciones en la base de datos o webhooks de GitHub (ej. `/api/aprobar-anomalia`) debe estar protegido por un `ADMIN_TOKEN`, validando cabeceras o payloads contra `import.meta.env`.
5. **Gestión de Cuota de API (SerpApi)**: Las APIs de pago se agotan rápido si se itera sobre todas las combinaciones. No usar `random.choice()` (arruina el análisis de tendencias estadístico). Usar siempre algoritmos determinísticos de partición (ej. Round-Robin usando `día del año % total de combinaciones`) para ciclar búsquedas sin saturar la cuota.
6. **Estado de Notificación (Anti-Spam)**: Toda notificación por mail debe estar acoplada a una llamada inmediata a la base de datos (ej. `mark_as_notified`) para persistir el estado y evitar spam en loops del grafo.
7. **Flujo de Despliegue Obligatorio (Git Push)**: Cada vez que el agente asistente (ej. Antigravity) termine de realizar y probar cambios en el código, **debe preguntar explícitamente al usuario** si desea pushear los cambios al repositorio remoto. Una vez obtenida la confirmación, el agente debe ejecutar `git commit` y `git push` para desplegar a producción (Vercel/Actions).
8. **Regla de Rescate (Critic Agent)**: La lógica de "Mejor del Día" (rescatar el vuelo más barato si todos son rechazados por límite de presupuesto) jamás debe rescatar vuelos de las `aerolineas_excluidas` por el usuario. El filtro de aerolíneas excluidas debe hacerse *antes* de cualquier evaluación para que el agente nunca tenga visibilidad sobre esos vuelos.
9. **Experiencia de Usuario (UI/UX)**: Queda prohibido el uso de `alert()` o modales bloqueantes nativos de Javascript. Se deben utilizar notificaciones "Toast" modernas, integradas al tema, y no intrusivas. Además, todo formulario de configuración del radar debe actualizar su previsualización en tiempo real (Live Summary) mediante JS sin necesidad de dar click a "Submit".
10. **Feedback del Scraper (Frontend)**: Para generar anticipación y feedback visual, el dashboard debe incluir un reloj regresivo (Countdown) sincronizado matemáticamente con los horarios de ejecución del cronjob del backend (ej. 09:00 y 21:00 hs), informando claramente al usuario cuándo será la próxima búsqueda masiva.
