# Búsquedas verificables y cobertura por fuente

Documento de soporte del diagnóstico de extracción. La operación vigente y el seguimiento
se describen en `agents.md` y `MONITORING.md`; esas reglas reemplazan decisiones históricas incompatibles.

El vuelo de la captura es EZE–MAD, 18/04/2027–01/05/2027, Aeroméxico, una escala por tramo, US$1.884 final para dos personas **con débito**. La captura demuestra una observación del usuario, no disponibilidad actual. La tarjeta de la app mostraba otra fecha de vuelta y un adulto.

## Cambios

- El scraper recorre todos los pares válidos de fechas y los países/orígenes elegidos, con cursores independientes para Google y Despegar. Despegar ya no depende de la fecha ganadora de Google. No hay selección aleatoria ni filtro oculto de duración de 10–20 días.
- Se leen todas las tarjetas cargadas y se conserva variedad de aerolíneas, incluida Aerolíneas Argentinas aunque no aparezca entre las primeras cinco. Esto cubre AR en los proveedores actuales; **no es una integración directa con el inventario de aerolineas.com.ar** ni garantiza cobertura exhaustiva.
- Precio USD, cantidad de pasajeros, aerolínea y escalas deben estar respaldados por la misma cotización. Despegar exige ambos tramos y sus fechas. Se eliminan precios tachados, la conversión ARS/USD fija y los valores de aerolínea/escalas por defecto.
- Google y SerpApi entregan inicialmente resultados de búsqueda. Se conserva `itineraryScope=search_result`: la UI identifica las escalas observadas en ida y pide revisar el regreso. No se confunde ese resultado con un itinerario completo ya seleccionado.
- La aprobación es individual y determinista. Gemini solo explica un dilema concreto entre precio y escalas con JSON Schema validado; máximo una llamada en cada proceso (TypeScript y Python), modelo configurable mediante `GEMINI_MODEL`, sin cascada de modelos. Python mantiene su crítico de refinamiento con un tope de una llamada por corrida y corte ante fallo.
- La pantalla filtra por pasajeros, origen, fechas, aerolíneas y presupuesto; muestra alternativas de una misma ruta. Las condiciones de pago se muestran en el detalle.

## Consumo y operación

El agente TypeScript hace como máximo 4 búsquedas Google y 2 Despegar por corrida, con límites diarios de 8 y 4. Pausa 30 segundos entre búsquedas de una fuente. Ante CAPTCHA/403/429, la pausa de esa fuente dura 24 horas y se conserva entre corridas. No se usa stealth, rotación de IP ni resolución de CAPTCHA. Esto reduce exposición; ningún scraping puede prometer ausencia de bloqueos.

Solo Python puede consumir SerpApi: 2 intentos por corrida, 4 por día, 220 por ciclo y al menos 10 créditos de reserva. Los límites por variables pueden reducir esos máximos. La consulta de cuenta falla cerrada. Las reservas se registran antes de llamar; un resultado incierto no devuelve crédito. La caché usa ruta, fechas, pasajeros y moneda. Los scrapers no activan un fallback pago.

GitHub Actions conserva cursores/cooldowns y el registro de cuota en caché y serializa cada workflow. El pipeline automático corre al finalizar el scraper y recibe su plan mediante un artefacto del run, evitando la segunda ejecución por cron. El `repository_dispatch` mantiene SerpApi deshabilitada. La caché de Actions puede perderse: para múltiples runners fuera de estos workflows o una aplicación de mayor escala, el siguiente paso es trasladar cursores, reservas y leases a Postgres con operaciones atómicas. Estos límites locales no reemplazan un contador global distribuido.

Las observaciones repetidas en `flight_deals` actualizan solo fecha de consulta, evidencia y enlace, conservando aprobación humana y notificación. Los guardados tienen un historial separado (`saved_deal_checks`) y no se sobrescriben con cada búsqueda. Python lee el estado persistido antes de notificar. El historial existente no se borra ni se interpreta retroactivamente como evidencia verificada.

## Despliegue

1. En una base existente, ejecutar `schema_quote_evidence.sql` para agregar `detalle_cotizacion` a vuelos y guardados. Es un cambio aditivo; no modifica RLS ni borra datos.
2. Verificar la columna con `select detalle_cotizacion from public.flight_deals limit 1;`.
3. Publicar código y workflows. Las credenciales de escritura requieren `SUPABASE_SERVICE_ROLE_KEY` en Actions.
4. Revisar el primer run: `search.completed` distingue `ok`, `empty`, `unverified`, `blocked` y `error`. Un selector que cambia no demuestra ausencia de vuelos.

La primera auditoría preparó `schema_quote_evidence.sql` sin aplicarla remotamente. Una auditoría posterior observó Google Flights en vivo y verificó la diferencia entre Mejores opciones y Los más bajos: el extractor ahora selecciona la segunda pestaña, espera la carga, cruza el precio visible con la descripción accesible y valida la consulta. Los datos Google del parser anterior se excluyen del feed/caché. Las pruebas offline no garantizan estabilidad futura del DOM ni disponibilidad de una tarifa.

## Verificación sin consumo

- `cd agent && npm run check && npm test`: planificación, fuente/pasajeros, límites, cooldowns, filtros, UI y extracción Despegar con Chromium y rutas interceptadas.
- `python -B evals/test_search_orchestration.py`: grafo real con recolectores/persistencia simulados, entrega de plan, aislamiento de caché y límites de consumo.
- `python -B evals/test_critic_decisions.py`: suite existente del Crítico. Conserva una brecha conocida marcada como `expectedFailure`: refinamiento inmediato tras un resultado vacío; el plan persistente explora otras combinaciones en las siguientes corridas.
- `cd frontend && npm run build`: compilación Astro SSR.

Referencias: [SerpApi Google Flights](https://serpapi.com/google-flights-api), [Gemini Structured Outputs](https://ai.google.dev/gemini-api/docs/structured-output), [Supabase upsert](https://supabase.com/docs/reference/javascript/upsert).
