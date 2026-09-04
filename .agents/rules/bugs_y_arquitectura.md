# Registro de Bugs y Secretos de Arquitectura (Fly Hunter)

Este archivo sirve como memoria a largo plazo para los agentes de IA que trabajen en este proyecto. Todo lo documentado aquí debe leerse antes de hacer modificaciones en las áreas mencionadas.

## 1. El problema del `created_at` y el Upsert en Supabase
- **Contexto:** El frontend filtra los vuelos vigentes buscando aquellos creados en las últimas 24 horas (`gte('created_at', yesterday)`). El backend usa `upsert` para evitar duplicados si encuentra el mismo vuelo.
- **El Bug:** Por defecto, Supabase NO actualiza la fecha `created_at` durante un upsert si no se envía explícitamente en el payload. Como resultado, las ofertas envejecían en la base de datos y desaparecían del frontend, a pesar de que el bot las seguía encontrando todos los días.
- **La Solución:** En el archivo `db.py` (función `upsert_deals`), SIEMPRE forzamos `created_at = datetime.now(timezone.utc).isoformat()` antes de hacer el volcado a la base de datos, para que actúe como un campo "última vez visto".

## 2. Dependencia Silenciosa de la tabla `search_alerts`
- **Contexto:** El Estratega lee las alertas configuradas por los usuarios desde Supabase (`public.search_alerts`) para decidir en qué destinos buscar vuelos.
- **El Bug:** Si la tabla `search_alerts` no existe en Supabase (ej: se diseñó el frontend pero nunca se corrió el `schema.sql` en la BD) o si no hay alertas activas, el Estratega asume que no hay búsquedas por hacer. El pipeline terminaba en verde (éxito) pero sin consultar a SerpApi.
- **La Solución:** 
  1. Hay que asegurarse de que el SQL para crear `search_alerts` esté ejecutado en Supabase.
  2. A nivel código, se agregó un **bloque de fallback** en `strategist.py` para que, si falla la lectura de alertas o está vacía, el bot busque por defecto vuelos a Europa en lugar de quedarse sin hacer nada.

## 3. Preselección de Pasajeros en Enlaces de Google Flights
- **Contexto:** Las alertas del usuario configuran un número exacto de pasajeros (ej. 2 adultos). Si se almacena en la base de datos una URL con el parámetro protobuf `tfs` generado para 1 pasajero por SerpApi, el usuario al hacer clic en la web es redirigido a una búsqueda para 1 sola persona.
- **La Solución:** En el frontend (`index.astro`), la URL hacia Google Flights **siempre debe construirse dinámicamente** utilizando la consulta en lenguaje natural con la cantidad exacta de adultos del radar:
  `https://www.google.com/travel/flights?q=Flights to ${dest} from ${origin} on ${depDate} through ${retDate} for ${passengers} adults&curr=USD&hl=es`.
  Esto garantiza que Google Flights se abra siempre con los 2 pasajeros preseleccionados en el navegador del usuario.

## 4. Limitaciones de Deep-Links y Bot Protection en OTAs (Despegar)
- **Contexto:** Despegar cuenta con protección estricta contra bots (DataDome / Cloudflare) y no admite enlaces directos en frío a URLs de resultados (`/vuelos/results/roundtrip/...`), devolviendo pantallas de error ("¡Recalculando! El GPS perdió la señal").
- **La Solución:** 
  1. No exponer enlaces directos calculados a mano hacia Despegar en la UI.
  2. La auditoría y comparación de tarifas de Despegar debe realizarla el agente de Playwright en segundo plano (simulando navegación completa o usando sesión activa).
  3. El frontend debe mostrar **únicamente el botón hacia la opción ganadora** que ya fue validada con un enlace funcional.

## 5. Cuota Real de SerpApi y Fecha de Renovación
- **Cuota Mensual:** La cuenta de SerpApi del usuario cuenta con **250 búsquedas por mes** (NUNCA asumir 100).
- **Ciclo de Renovación:** La cuota se renueva automáticamente el **día 23 de cada mes** (ej. 23 de septiembre).
- **Estrategia de Optimización:**
  1. Playwright (scalpeo directo a $0) actúa como motor primario y escudo de cuota diario para preservar los 250 créditos.
  2. SerpApi actúa como red de seguridad (fallback) infalible en caso de fallo o para sampling estadístico en Python.

## 6. Arquitectura de Grafos Cíclicos (LangGraph State Machine)
- **Concepto:** En lugar de una cadena lineal estática (waterfall), el backend opera como un grafo de estados cíclico con razonamiento LLM (`Gemini Flash / OpenAI`):
  1. **Loop de Refinamiento (Self-Correction):** Si el Crítico detecta que los vuelos encontrados no cumplen el presupuesto o las escalas, evalúa semánticamente si mover las fechas (+/- 1 o 2 días dentro de la ventana) puede rescatar tarifas más bajas y re-enruta el flujo hacia el recolector.
  2. **Loop Multi-Alerta:** Procesa de forma secuencial todas las alertas activas en Supabase (`alerts_queue`) antes de avanzar al nodo de Data Scientist.
  3. **Límites de Seguridad (Guards):** Máximo 2 iteraciones por alerta (`max_iterations = 2`) y lectura previa de caché en Supabase para no agotar la cuota de SerpApi ni tokens de LLM.
