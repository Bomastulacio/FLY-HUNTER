# Búsquedas verificables y cobertura por fuente

## Auditoría del 21/09/2026 — corrida #49

La [corrida 35655172449](https://github.com/Bomastulacio/FLY-HUNTER/actions/runs/35655172449)
superó los tests después de instalar las dependencias del frontend, pero registró cero cotizaciones.
Solo intentó Google AEP–MIA 11/01–07/02/2027, un adulto (`page_timeout`, 6771 ms),
y Despegar EZE–MIA 19/01–04/03/2027, un adulto (`blocked`). Las pausas globales de
una hora por error y 24 horas por bloqueo impidieron consultar el otro radar en esa corrida.
Esto no demuestra ausencia de vuelos EZE–MAD 17/04–01/05/2027 para dos adultos.

Las capturas del usuario muestran la traducción «Más económicos», incompatible con el
selector anterior «Los más bajos». El extractor admite ambas y conserva las verificaciones
de consulta, pasajeros y precio. Las esperas de carga inicial/final pasan de 5/8 a 25 segundos,
sin reintentos ni búsquedas adicionales. Los errores ahora incluyen la etapa en logs, plan
y resumen. El timeout histórico no registró etapa: no se atribuye retrospectivamente a un
selector concreto. No se borran las pausas ni se aumentan cuotas.

El fixture offline de las capturas usa precios de US$1.535/2.016/2.172/2.173 y markup accesible
sintético; no es un DOM capturado en vivo ni evidencia de disponibilidad actual. Con presupuesto
US$1.700–2.400, el mínimo vigente excluye US$1.535 (no baja de US$1.500 para dos adultos),
mientras los otros tres pasan. Los filtros no se cambian. La validación remota pendiente debe
usar el foco existente `EZE,MAD,2027-04-17,2027-05-01,2`, dentro de un radar activo y respetando
pausas y cuota. Una prueba offline no garantiza acceso desde Actions.

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

## Auditoría con evidencia de ejecución — 14/09/2026

La captura recibida muestra Aeroméxico a US$1.884 y Aerolíneas Argentinas a US$2.376,
ambas finales para dos personas con débito, EZE–MAD 18/04/2027–01/05/2027.
Son observaciones de la captura, no precios actuales ni registros insertados en producción.

Se inspeccionaron los resúmenes y logs reales de Actions, además de los tests:

- [Corrida manual #31](https://github.com/Bomastulacio/FLY-HUNTER/actions/runs/34744393657):
  la combinación exacta de la captura sí se intentó en Despegar y terminó `blocked`, cero
  cotizaciones. Google devolvió cuatro resultados de búsqueda para esa combinación.
- [Corrida #32](https://github.com/Bomastulacio/FLY-HUNTER/actions/runs/34760711559):
  Google consultó Barcelona y Londres con ida 17/04/2027; Despegar no tuvo intentos.
- [Corrida #33](https://github.com/Bomastulacio/FLY-HUNTER/actions/runs/34788611025):
  cero consultas y cero cotizaciones, aunque el job terminó exitosamente. Los logs históricos
  usan `budget_or_cooldown` y no permiten distinguir esas dos causas por sí solos.

Esto prueba un bloqueo de Despegar para la consulta concreta. No prueba que la tarifa se haya
agotado, que el usuario haya configurado mal los pasajeros ni que los nuevos parsers eludan
el bloqueo. No se vació la caché ni se forzó otra búsqueda de Despegar.

### Cobertura y correcciones

- Ejemplo reproducible, no lectura de los parámetros privados de producción: dos orígenes,
  cuatro países (nueve aeropuertos), tres idas y ocho vueltas generan 432 combinaciones.
  Con cuatro intentos diarios de Despegar, recorrerlas una vez necesita como mínimo 108 días
  si toda la capacidad fuera para ese radar, sin seguimiento ni bloqueos. El feed conserva
  vigencia de 24 h: una vuelta completa de 108 días no es cobertura vigente simultánea.
- Se distribuyen países, orígenes y fechas desde las primeras consultas, conservando todas
  las combinaciones. Cambiar solo presupuesto no reinicia el cursor. Cambiar el orden de
  exploración inicia una firma nueva, pero mantiene reservas de cuota y pausas existentes.
- Las pausas nuevas conservan causa y fecha real. Los logs y el resumen de Actions distinguen
  tope por corrida, tope diario (incluye manuales), bloqueo, error y pausa histórica sin motivo.
  La cobertura se calcula respecto de la fecha mostrada, también al reutilizar caché.
- Despegar ignora variantes ocultas y precios tachados por CSS; verifica ruta, fecha y escala
  de cada dirección. Los fixtures de US$1.884 y US$2.376 llegan al feed offline con débito.
- Google rechaza una fecha explícita de fila que contradiga la consulta; una carga que no
  termina no publica tarifas provisionales y un CAPTCHA tardío conserva estado de bloqueo.
- Python elimina el límite oculto de 32 horas, exige pasajeros exactos sin prorratear y conserva
  subas válidas fuera de presupuesto como observaciones `no_aplica` de alcance radar.
  El límite de duración no era la causa demostrada del vacío de Despegar: TypeScript persiste
  esas cotizaciones antes de Python.
- El hash Python conserva el contrato TypeScript desplegado para evitar duplicados y pérdida
  del estado de notificación. Añadir escalas/fare family al hash requiere una migración compatible;
  no se cambia unilateralmente en un solo productor.

### Fuentes solicitadas: Turismocity y Aerolíneas Argentinas

Turismocity se pudo abrir y su [programa de afiliados](https://www.turismocity.com.ar/afiliados)
ofrece integración y soporte. Sus [condiciones, sección 4](https://www.turismocity.com.ar/condiciones)
restringen extracción/scraping; no se habilita una fuente automática basada en endpoints privados
ni se interpreta afiliación como acceso API garantizado. Solicitar al programa un feed/API,
alcance, moneda, pasajeros, enlaces y autorización de uso. No se envió ningún mensaje externo.
Es un metabuscador: resultados duplicados de otras agencias no agregan inventario independiente.

La web de Aerolíneas permite elegir aeropuertos exactos, ida/vuelta, dos adultos y desactivar
fechas flexibles. Una única prueba exploratoria se reservó localmente antes de buscar.
La opción visible «Pago en USD» redirige oficialmente a `/es-uy/`; no es una conversión ARS/USD
calculada por Flight Hunter. Tras seleccionar ambos tramos, el resumen mostró **US$2.336,60
para dos adultos**, tarifa Base, ida AR1134 (18/04 15:05) y vuelta AR1133 (01/05 20:05), ambos
directos. Se verificaron los números de vuelo en el detalle; no se avanzó al botón Comprar.
La tarifa Base muestra artículo personal y una pieza de cabina de 10 kg; equipaje en bodega
con cargo. No afirmar equivalencia de equipaje/condiciones con la captura de Despegar.
El total se leyó del resumen, no se calculó multiplicando los importes de la tabla.
Esta es una observación puntual del 14/09/2026, no una promesa de disponibilidad posterior.
El éxito en un navegador
personal no verifica acceso estable desde GitHub Actions. Esta auditoría no activa un adaptador
directo de Aerolíneas ni agrega cuota/cron; la integración directa sigue siendo una etapa separada
según `MONITORING.md`.

Despegar también documenta una [API de vuelos para partners](https://api-docs.despegar.com/docs/Flight).
Su existencia no implica credenciales disponibles, uso gratuito ni igualdad con promociones
minoristas de débito. Es una vía para evaluar si se necesita cobertura estable.

### Verificación y límites pendientes

Validación local: 36 tests TypeScript (incluyen Chromium interceptado, feed, cuotas, PGlite/RLS
y autorización administrativa del endpoint),
TypeScript check y build Astro aprobados. Python: 13 tests de orquestación y 22 del Crítico,
sin errores, con una brecha documentada `expectedFailure` sobre refinamiento tras vacío.
En Windows se usó `PYTHONIOENCODING=utf-8`; una consola cp1252 puede fallar al imprimir los
logs existentes y confundir un fallo de log con uno de caché. Las pruebas no consumen proveedores,
SerpApi ni Gemini. La navegación de factibilidad se registra por separado de los tests.

La revisión del commit de seguridad detectó además que una sesión autenticada podía invocar
escrituras globales de `flight_deals` con service role. El endpoint ahora exige el privilegio
`app_metadata.flight_hunter_admin === true` gestionado desde el servidor, o el `ADMIN_TOKEN`
existente en un header de un llamador backend autenticado. `user_metadata` no autoriza.
Solo cambia filas pendientes: una revisión repetida no reinicia la notificación. El frontend
no recibe secretos. Asignar ese privilegio administrativo a la cuenta autorizada es un paso
operativo pendiente; no se modificaron usuarios ni metadatos de Supabase remoto.

No hacen falta nuevos agentes LLM: faltan acceso verificable a fuentes y cobertura suficiente.
Se mantienen el grafo, el plan compartido, la aprobación determinista y la cuota. Una segunda
capa de agentes o RAG no transforma un bloqueo en una cotización válida.
