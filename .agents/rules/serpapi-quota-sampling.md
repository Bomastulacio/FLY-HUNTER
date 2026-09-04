---
description: Estrategia para manejar rangos de búsqueda con APIs de límite bajo (como SerpAPI).
---
# Estrategia de Búsqueda por Rango con Cuotas Restrictivas

Cuando se implementen características que generen combinaciones de búsqueda contra SerpAPI (cuenta con **250 requests/mes**, que renueva el **23 de cada mes**):
1. NO iterar de forma exhaustiva sobre todas las combinaciones generadas de una sola vez.
2. SIEMPRE implementar una lógica de **muestreo (sampling)**, seleccionando un subset seguro (ej. 3 a 5 combinaciones) de forma aleatoria por cada ejecución del ciclo/cron.
3. El motor de scalpeo directo Playwright actúa como escudo primario a costo $0 para preservar los 250 créditos para fallback y verificación estructurada.
4. El objetivo de negocio es encontrar "el oro" (el resultado más barato) progresivamente en varios ciclos sin agotar la cuota de la API.
5. **Auditoría Automática sin Costo (`/account.json`):** El sistema consulta el endpoint oficial de cuenta (costo $0) antes de cada llamada. Si quedan <= 2 búsquedas, bloquea cualquier intento de consumo hasta el día **23 de septiembre**. Al renovarse los 250 créditos, desbloquea y contabiliza automáticamente el cupo disponible para muestreo híbrido y fallback inteligente.

