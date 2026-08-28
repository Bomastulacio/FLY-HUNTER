---
description: Estrategia para manejar rangos de búsqueda con APIs de límite bajo (como SerpAPI).
---
# Estrategia de Búsqueda por Rango con Cuotas Restrictivas

Cuando se implementen características que generen combinaciones masivas de búsqueda (ej. rangos de fechas) contra una API con cuotas estrictas (como los 250 request/mes de SerpAPI):
1. NO iterar de forma exhaustiva sobre todas las combinaciones generadas de una sola vez.
2. SIEMPRE implementar una lógica de **muestreo (sampling)**, seleccionando un subset seguro (ej. 3 a 5 combinaciones) de forma aleatoria por cada ejecución del ciclo/cron.
3. El objetivo de negocio es encontrar "el oro" (el resultado más barato) progresivamente en varios ciclos sin agotar la cuota de la API.
