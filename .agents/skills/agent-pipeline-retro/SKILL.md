---
name: agent-pipeline-retro
description: >-
  Use when diagnosing GitHub Actions pipeline runs, evaluating flight agent performance,
  investigating provider blocks or empty feeds, and converting observed failures and successes
  into permanent eval tests, contract fixtures, and architecture rules.
---

# Agent Pipeline Retrospective & Continuous Feedback

Esta skill define el protocolo para auditar, diagnosticar y retroalimentar los agentes de Flight Hunter utilizando la telemetría de GitHub Actions y el MCP de GitHub.

El objetivo es cerrar el ciclo de mejora continua (*evals-driven feedback flywheel*): **cada error o anomalía detectada en producción debe transformarse en una prueba de regresión o contrato ejecutable.**

---

## 1. Cuándo activar esta Skill

- Una corrida de `flight-hunter-agent` o `flight-hunter-pipeline` terminó en `failure` o `cancelled`.
- El usuario reporta discrepancias entre lo que ve en la web y los resultados de búsqueda.
- Despegar o Google Flights incrementan su tasa de bloqueo (`provider_blocked`).
- Se desea realizar una auditoría periódica de las últimas corridas para evaluar salud, latencia y cuota.

---

## 2. Flujo de Diagnóstico Paso a Paso

### Paso 1: Obtener las últimas corridas de GitHub Actions
Utilizar el script de auditoría o invocar el MCP de GitHub:
```powershell
node .agents/skills/agent-pipeline-retro/scripts/audit_pipeline.mjs
```
O consultar directamente vía API las últimas corridas de:
1. `flight-hunter-agent` (`agent-hunt.yml`): Playwright, scraping y persistencia.
2. `flight-hunter-pipeline` (`pipeline.yml`): LangGraph, análisis y evaluación.
3. `quality` (`quality.yml`): Verificación offline de tipos, contratos y evals.

### Paso 2: Clasificar la Causa Raíz
Clasificar cualquier fallo o advertencia en una de las siguientes 5 categorías:

| Categoría | Síntoma típico | Acción requerida |
|---|---|---|
| **A. Infraestructura / Base de Datos** | `missing_monitoring_schema`, error de conexión Supabase, token vencido | Aplicar migraciones SQL pendientes o sincronizar secrets de GitHub. |
| **B. Bloqueo de Proveedor (Anti-Bot)** | `status: blocked`, `reason: provider_blocked` persistente | Verificar si se activó el cooldown preventivo; nunca reintentar en bucle. Considerar rotación de User-Agent o pausas más largas. |
| **C. Deriva de Selectores / DOM** | `quotes: 0` cuando el proveedor responde 200 OK | Extraer fixture HTML offline y actualizar parser en `agent/src/providers/`. |
| **D. Inconsistencia de Contrato / Geografía** | El planificador busca un destino que el frontend o Crítico descarta | Añadir el caso a `shared/radar-contract-cases.json` y actualizar `shared/radar-geography.json`. |
| **E. Decisión de Negocio / Filtros del Crítico** | Vuelos válidos rechazados erróneamente por escalas, pasajeros o presupuesto | Agregar test unitario a `evals/test_critic_decisions.py`. |

### Paso 3: Codificar el Aprendizaje (No dejarlo como texto informal)

Todo aprendizaje debe quedar sellado en tres lugares:

1. **Test de Regresión Inmediato:**
   - Si fue de geografía o mapeo: agregar el par en `shared/radar-contract-cases.json`.
   - Si fue de decisión del crítico: agregar el método de test en `evals/test_critic_decisions.py`.
   - Si fue de presupuesto o caché: agregar caso en `evals/test_search_orchestration.py`.

2. **Regla de Arquitectura (`agents.md`):**
   - Si el aprendizaje implica una restricción permanente de negocio o infraestructura, documentarla en la sección `8. Reglas Críticas Aprendidas (Post-Mortem)` de `agents.md`.

3. **Verificación de Calidad Offline:**
   - Correr siempre antes de pushear:
     ```bash
     npm test --prefix agent
     python -B evals/test_critic_decisions.py
     python -B evals/test_search_orchestration.py
     python -B evals/test_radar_contract.py
     ```

---

## 3. Principios de Diseño Aprendidos

1. **Telemetría Estructurada > Prompts Libres**: El pipeline en vivo no debe leer logs no estructurados para tomar decisiones de búsqueda. Debe usar estados determinísticos (`ok`, `blocked`, `deferred`) guardados en Supabase (`radar_scan_status`).
2. **Fail-Fast Preventivo**: El agente debe verificar la presencia de esquemas y cuotas *antes* de iniciar navegadores o gastar créditos de API.
3. **Idempotencia Absoluta**: Toda corrida debe poder reintentarse o fallar sin duplicar filas en `flight_deals` ni re-enviar emails ya despachados.
