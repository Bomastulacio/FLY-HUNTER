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
