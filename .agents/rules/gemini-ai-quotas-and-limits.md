---
description: Límites de cuota, frecuencia y reglas de uso para la API de Gemini en Fly Hunter.
---
# Cuotas de Gemini AI y Reglas de Consumo Inteligente

Memoria permanente para agentes sobre los límites de Google AI Studio configurados para el proyecto **Fly Hunter**:

## 1. Métricas Reales de la Cuenta (Nivel Gratuito)
* **Modelo Principal (Gemini Flash):**
  * **RPD (Requests por Día):** `20` peticiones cada 24 horas.
  * **RPM (Requests por Minuto):** `5` peticiones simultáneas por minuto.
  * **TPM (Tokens por Minuto):** `250.000` tokens/minuto.
* **Entorno Agentes (Antigravity):**
  * **RPD:** `100` peticiones por día.
  * **RPM:** `60` peticiones por minuto.

## 2. Reglas Mandatorias de Arquitectura
1. **Evaluación en Lote (Batching Obligatorio):**
   - **NUNCA** llamar al LLM en un bucle individual por cada vuelo extraído.
   - Enviar siempre el conjunto filtrado (top 5 a 6 vuelos candidatos) en un único payload JSON estructurado. Esto garantiza exactamente **1 llamada LLM por alerta**.
2. **Tope en Loops de Refinamiento:**
   - En el grafo de LangGraph, los loops de auto-corrección de búsqueda están topados estrictamente a `max_iterations = 2`.
   - Con un cron que corre 2 veces al día (09:15 y 21:15 UTC), el consumo diario total es de **4 a 8 llamadas/día**, utilizando únicamente entre el **20% y el 40%** de los 20 RPD disponibles.
3. **Resiliencia contra Error 429 (Cuota Agotada):**
   - Todo agente que consulte a Gemini (tanto en TypeScript como en Python) debe envolver la llamada en un bloque `try/catch`.
   - Si la API responde con `429 Too Many Requests` o se agota la cuota diaria, el sistema **DEBE degradar elegantemente al evaluador determinista por reglas de negocio** (`filter_and_evaluate`), garantizando que el pipeline finalice en verde.
4. **Cascada de Modelos:**
   - Probar en orden: `gemini-3.6-flash`, `gemini-2.5-flash`, `gemini-2.0-flash`, `gemini-1.5-flash`.
