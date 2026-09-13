# Flight Hunter — Reglas vigentes de desarrollo y operación

Actualizado: 13/09/2026. Este archivo y `MONITORING.md` describen la implementación vigente.
`SEARCH_RELIABILITY.md` conserva el diagnóstico de extracción y sus límites. Ante textos
históricos contradictorios, prevalecen estas reglas. No crear otra copia `agent.md`.

1. Objetivo del proyecto
Aplicación de monitoreo autónomo de vuelos ida y vuelta para uso personal y pocas personas. Cada usuario configura sus propios radares, pasajeros, destinos, fechas y presupuesto. Guardar conserva una cotización y habilita seguimiento de combinaciones comparables dentro de sus radares activos. Preparar una futura expansión sin prometer cobertura exhaustiva ni precios en tiempo real. Multidestino/open-jaw e inventarios directos nuevos requieren una etapa separada.

Ejemplo personal inicial, nunca constantes globales para otros usuarios: EZE/AEP–Europa, 2 pasajeros, US$1700–2400. Ventanas de fecha de ese ejemplo:
Ida: 17 al 19 de abril de 2027
Vuelta: 26 de abril al 1–2 de mayo de 2027

Regla de alerta crítica ("oportunidad de oro"): umbral proporcional a los pasajeros (US$750 por adulto en la política actual). Siempre verificar antes evidencia, moneda, pasajeros, aerolíneas excluidas y máximo 1 escala. Un precio bajo jamás evita los filtros duros.
Regla de anomalía: un desvío permitido por el Crítico (por ejemplo una fecha cercana) requiere aprobación humana. Dos o más escalas o aerolíneas excluidas siempre se rechazan, también en el rescate.

2. Arquitectura de ejecución (definición cerrada)
No usar Vercel Functions ni un servidor persistente para correr el pipeline. Usar GitHub Actions con schedule (cron) como motor de ejecución periódica del grafo LangGraph. Motivo: es gratuito, no requiere mantener infraestructura corriendo, y los jobs soportan hasta 6 horas de ejecución (de sobra para los loops de reflexión del Crítico).

El único cron de búsquedas corre dos veces por día: `0 9,21 * * *` UTC (06:00 y 18:00 en Argentina). No pasar a cada 6 horas sin decisión explícita y revisión de cuota/cobertura. Los horarios son estimados, no confirmación de una corrida exitosa.
El scraper inicia el pipeline Python por `workflow_run` y le entrega `search-plan.json` de esa corrida. No agregar un segundo cron independiente. Los workflows aceptan:
- workflow_dispatch (para poder ejecutarlo manualmente desde la UI de GitHub cuando quieras forzar una corrida)
- repository_dispatch con tipo resume-after-approval (para retomar el ciclo automáticamente cuando se aprueba una anomalía desde la web)

Vercel se usa solo para:
- Servir el frontend Astro (el Bento Grid).
- Un endpoint API (/api/aprobar-anomalia) que recibe el click de Aprobar/Rechazar desde la web, actualiza Supabase, y dispara el repository_dispatch hacia GitHub Actions.

3. Stack tecnológico (definitivo)
Orquestación: Python + LangGraph + Pandas.
Datos: adaptadores Playwright Google Flights y Despegar. Solo Python puede usar SerpApi como respaldo presupuestado (`SERPAPI_KEY`). SerpApi consulta Google Flights; no es un tercer inventario independiente. Gemini solo explica dilemas sobre datos válidos.
No reintentar 403/429/CAPTCHA en bucle: pausar la fuente. Mantener topes globales existentes (Google 4/Despegar 2 por corrida; 8/4 diarios; SerpApi 2 por corrida, 4 diarios, 220 por ciclo con reserva). Ninguna apertura de la app, guardado, cambio de radar o widget puede lanzar búsquedas externas. Cada intento se reserva antes de I/O, aunque falle.
Filtrar resultados con flight.price_unknown — Google no siempre expone precio agregado por fila; esas filas no sirven para comparar contra presupuesto.

Base de datos: Supabase (Postgres), con service_role_key solo en el pipeline/backend. El frontend usa clave pública y Auth/RLS: lectura del feed y escritura de los radares, guardados y preferencias propios; nunca escritura de observaciones verificadas.

Frontend: Astro. El grid necesita datos que cambian entre corridas del pipeline — no puede ser 100% estático (SSG puro). Usar SSR/ISR en Vercel o componente cliente que consulta Supabase directamente en onMount.

Notificaciones: Resend (o similar) para email transaccional. Mantenerlo simple.

Despliegue: Vercel (frontend + endpoint de aprobación) + GitHub Actions (pipeline).
IDE / meta-desarrollo: Antigravity, con este archivo como agents.md.

4. Esquema de datos en Supabase
Ver `schema.sql`, `schema_quote_evidence.sql` y `schema_monitoring.sql`, en ese orden para instalaciones existentes según columnas disponibles.
hash_dedupe con constraint unique es lo que evita insertar la misma oferta dos veces entre corridas — usar on conflict do nothing.

5. Flujo del grafo (LangGraph)
El planificador TypeScript alterna exploración determinista y seguimiento, rota radares y comparte consultas idénticas dentro de la corrida. Ambos consumen el mismo presupuesto; seguimiento no crea otro loop.
Python procesa la cola de radares con Estratega → selección de alerta → Supervisor/recolección → Analista → Crítico → persistencia/notificación → siguiente alerta. Conserva el refinamiento acotado existente. No agregar recolectores paralelos que eviten el registro de consumo.
El Analista conserva el total cotizado y la cantidad de pasajeros verificada; no vuelve a multiplicar un precio ya totalizado.
Agente Crítico: 
- Si la oferta cumple presupuesto y ventana de fechas → aprueba, marca para insertar.
- Si el precio está por debajo del umbral crítico → marca es_oportunidad_oro = true.
- Si presenta un desvío admitido por la política (por ejemplo fecha cercana) → puede quedar pendiente. Escalas >1 y aerolíneas excluidas son rechazos duros.
Nodo de persistencia: hace upsert en flight_deals con on conflict (hash_dedupe) do nothing.
Nodo de notificación: 
- Si hay filas nuevas con es_oportunidad_oro = true y notificado = false → manda email inmediato vía Resend, marca notificado = true.
- Si hay filas nuevas con estado_aprobacion = 'pendiente' → manda email "tenés una anomalía para revisar" con link a la app.
Fin del run. 

6. Frontend — Cards compactas y seguimiento
Conservar Astro, Vanilla CSS, Phosphor, estética glass/pasaje y disclosure progresivo actuales. No rediseñar la UI sin solicitud. El radar activo determina el feed; Guardados conserva sus cards y muestra observaciones comparables sin alterar el precio original. El radar principal es preferencia de presentación sincronizada por cuenta, no permiso para gastar más cuota.
La app consulta resultados propios al abrir/recuperar foco y cada 2 minutos mientras está visible. El panel desplegable de fuentes distingue pendiente, error, bloqueo y cobertura parcial; jamás afirmar que se consultó toda la ventana por haber ejecutado un cron.

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

1. **Consultas Históricas (UI vs DB)**: El feed y la caché de Python usan las últimas 24 horas y la observación más reciente por combinación comparable antes de filtrar por presupuesto. Una suba reemplaza el precio viejo para comparar, sin borrar historial ni guardados. Las cotizaciones verificadas fuera de presupuesto pueden persistirse como `no_aplica` con `detalle_cotizacion.budgetScope = 'radar'`; cada radar aplica sus límites. Nunca convertirlas en rechazo global ni alterar rechazos humanos/pendientes.
2. **Tolerancia Cero en Escalas**: La regla de negocio es estricta: **Máximo 1 escala**. Cualquier vuelo con 2 o más escalas debe ser rechazado al inicio del Crítico (regla de early return), sin importar si el precio entra en la categoría de "Anomalía" u "Oportunidad de Oro".
3. **Evaluación de Límites**: Las constantes de límites (ej. `BUDGET_MIN`) no deben ser solo declarativas. Deben formar parte activa de las condiciones (ej. `BUDGET_MIN <= precio`).
4. **Protección de Endpoints Manuales**: Los endpoints administrativos/de dispatch conservan `ADMIN_TOKEN` del servidor. Las preferencias y guardados personales usan Supabase Auth + RLS por propietario; nunca distribuir `ADMIN_TOKEN` o service role al navegador. Las observaciones y estados del motor solo se escriben desde el backend.
5. **Gestión de Cuota de API (SerpApi)**: Las APIs de pago se agotan rápido si se itera sobre todas las combinaciones. No usar `random.choice()` (arruina el análisis de tendencias estadístico). Usar siempre algoritmos determinísticos de partición (ej. Round-Robin usando `día del año % total de combinaciones`) para ciclar búsquedas sin saturar la cuota.
6. **Estado de Notificación (Anti-Spam)**: Toda notificación por mail debe estar acoplada a una llamada inmediata a la base de datos (ej. `mark_as_notified`) para persistir el estado y evitar spam en loops del grafo.
7. **Flujo de Despliegue Obligatorio (Git Push)**: Cada vez que el agente asistente (ej. Antigravity) termine de realizar y probar cambios en el código, **debe preguntar explícitamente al usuario** si desea pushear los cambios al repositorio remoto. Una vez obtenida la confirmación, el agente debe ejecutar `git commit` y `git push` para desplegar a producción (Vercel/Actions).
8. **Regla de Rescate (Critic Agent)**: La lógica de "Mejor del Día" (rescatar el vuelo más barato si todos son rechazados por límite de presupuesto) jamás debe rescatar vuelos de las `aerolineas_excluidas` por el usuario. El filtro de aerolíneas excluidas debe hacerse *antes* de cualquier evaluación para que el agente nunca tenga visibilidad sobre esos vuelos.
9. **Experiencia de Usuario (UI/UX)**: Queda prohibido el uso de `alert()` o modales bloqueantes nativos de Javascript. Se deben utilizar notificaciones "Toast" modernas, integradas al tema, y no intrusivas. Además, todo formulario de configuración del radar debe actualizar su previsualización en tiempo real (Live Summary) mediante JS sin necesidad de dar click a "Submit".
10. **Feedback del Scraper (Frontend)**: Para generar anticipación y feedback visual, el dashboard debe incluir un reloj regresivo (Countdown) sincronizado matemáticamente con los horarios de ejecución del cronjob del backend (ej. 09:00 y 21:00 hs), informando claramente al usuario cuándo será la próxima búsqueda masiva.
11. **Iconografía (Phosphor Icons)**: Queda terminantemente prohibido el uso de emojis genéricos del sistema operativo para la iconografía de la aplicación (ej. ✈️, ⚙️, 📍). Se debe utilizar de manera excluyente la librería [Phosphor Icons](https://phosphoricons.com/) a través de su script web o paquete, utilizando la sintaxis de clases `<i class="ph ph-[icono]"></i>` para garantizar una estética premium, uniforme y personalizable mediante CSS en todas las pantallas.
12. **Arquitectura de Estado Dividido (Split-State UX)**: Todo componente de configuración compleja debe separar el estado de "Creación" (Formulario/Wizard) del estado "Activo". Si hay datos guardados, renderizar un "Dashboard de Solo Lectura" dividido en bloques lógicos, ocultando el formulario principal. Cada bloque debe tener un botón de edición granular (lápiz) que reabra el formulario en ese paso específico. Nunca duplicar la información de resumen si ya existe un Dashboard activo.
13. **Layouts de Datos Responsivos (Mobile-First)**: Para pares de datos (Label + Value) en tarjetas, usar siempre estructuras apiladas (`flex-direction: column; align-items: flex-start;`) donde el Label va arriba en tamaño reducido/mayúsculas y el Valor va abajo en tamaño mayor. Evitar `flex-direction: row` con `space-between` para textos que puedan volverse largos (como fechas o listas).
14. **Formateo de Divisas y Números**: Cualquier renderizado de precios o presupuestos debe usar `Intl.NumberFormat('es-AR')` o utilidades equivalentes del framework para garantizar la presencia de separadores de miles (ej. `US$2.400` en lugar de `US$2400`).
15. **Preselección Dinámica de Pasajeros (Google Flights)**: Nunca confiar en enlaces directos estáticos almacenados en la base de datos si provienen de consultas con 1 solo pasajero (como el parámetro protobuf `tfs` de SerpApi). El frontend debe construir la URL en vivo con `for ${passengers} adults` (`https://www.google.com/travel/flights?q=...&curr=USD&hl=es`) para garantizar que Google Flights se abra con la cantidad exacta de adultos del radar.
16. **Principio de CTA Único para la Opción Ganadora**: En las tarjetas de vuelos, nunca amontonar múltiples botones de diferentes plataformas. El sistema debe comparar internamente todas las fuentes (Google Flights vs Despegar) y renderizar un único botón principal hacia la plataforma ganadora con la tarifa más baja comprobada.
17. **Protección Anti-Bot en OTAs (Despegar)**: OTAs como Despegar implementan protecciones estrictas (DataDome / Cloudflare) y rechazan deep links en frío a `/vuelos/results/roundtrip/...` con pantallas de error ("GPS perdió señal"). Las búsquedas en Despegar deben orquestarse mediante el agente de Playwright con sesiones activas, y la UI solo debe exponer enlaces funcionales validados.

18. **Seguimiento sin falsificar identidad**: `saved_deals` conserva la cotización guardada. `saved_deal_checks` agrega observaciones idempotentes; una suba se registra aunque ya no entre en presupuesto. Solo se comparan misma ruta, fechas, pasajeros, aerolínea, escalas y condición de pago. Sin números de vuelo/fare family no afirmar que es exactamente el mismo ticket. Un fallo conserva el último precio conocido y muestra su antigüedad.
19. **Verificación antes del despliegue**: ejecutar los tests offline del agente (incluyen SQL/RLS en PGlite), TypeScript, build Astro y los evals Python si se altera su comportamiento. Los tests nunca consumen SerpApi, Gemini ni consultan proveedores en vivo. No generar datos ficticios de producción para completar una card.
20. **Hoja de ruta única**: consultar `MONITORING.md` para instalación, límites y siguientes etapas (push, widgets nativos y escalado). No sumar agentes, RAG, cron o memoria paralelos para resolver funciones ya cubiertas por este flujo.
