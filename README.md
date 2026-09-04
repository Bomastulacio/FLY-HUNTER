# 🛫 Fly Hunter

Un sistema autónomo y proactivo de rastreo, evaluación y alerta de pasajes aéreos globales, construido sobre una arquitectura de **Doble Motor: Playwright Stealth + LangGraph State Machine con Razonamiento LLM (Gemini Flash)**.

---

## 🎯 ¿Qué es Fly Hunter?

Fly Hunter automatiza la búsqueda de vuelos baratos (ej: Buenos Aires hacia Madrid, Barcelona, Miami o Tokio) para múltiples alertas de viaje configuradas en tiempo real. 

A diferencia de los buscadores comerciales tradicionales, cuenta con un **Doble Motor Híbrido**:
1. **Motor de Scalpeo Directo a Costo $0 (TypeScript / Playwright)**: Navega de forma autónoma con emulación de navegador real y plugins stealth para consultar Google Flights y Despegar sin consumir cuota de API.
2. **Motor de Inteligencia de Grafos Cíclicos (Python / LangGraph)**: Ejecuta una máquina de estados cíclica con razonamiento de IA para evaluar presupuestos, ejecutar **loops de auto-corrección** (refinando fechas si una tarifa excede el presupuesto), y proteger la cuota de **SerpApi (250 búsquedas/mes, renueva los días 23)**.

---

## 🏗 Arquitectura del Sistema (Dual-Engine)

```mermaid
graph TD
    Trigger([🕒 GitHub Actions Cron<br/>09:00 y 21:00 UTC]) --> Engine1
    
    subgraph Motor 1: Autonomous Browser Hunter (TypeScript / Playwright)
        Engine1[🤖 Agent in the Loop] -->|Lee Alertas| DB1[(Supabase)]
        Engine1 -->|Playwright Stealth| GF[🌐 Google Flights]
        Engine1 -->|Bypass / Deep-Link| DP[🛒 Despegar]
        GF & DP --> Evaluator[🧠 Agente Gemini Flash<br/>Comparador y Veredicto]
        Evaluator -->|Upsert Vuelos Frescos| DB2[(Supabase: flight_deals)]
    end
    
    Engine1 -->|workflow_run| Engine2
    
    subgraph Motor 2: LangGraph Cyclic State Machine (Python)
        Engine2[🧠 Estratega] --> PickAlert[🎯 Selector de Alertas en Cola]
        PickAlert --> Supervisor[📡 Recolector Híbrido]
        
        Supervisor -->|1. Intenta Caché Supabase $0| Cache{¿Hay datos de Playwright?}
        Cache -->|Sí: Preserva Cuota| Clean[🧹 Sanitizer & Pandas Analyst]
        Cache -->|No: Fallback| Serp[🌐 SerpApi Google Flights]
        Serp --> Clean
        
        Clean --> Critic[⚖️ Agente Crítico LLM<br/>Gemini Flash / Reglas]
        
        %% Loop 1: Refinamiento
        Critic -->|needs_refinement && iter < 2| Refine[🔄 Refine Search Node<br/>Ajusta Fechas +/- 1-2 días]
        Refine --> Supervisor
        
        %% Persistencia & Notificaciones
        Critic -->|Aprobado o Max Iter| Persist[💾 Persistencia & Resend]
        
        %% Loop 2: Multi-Alerta
        Persist -->|Quedan alertas en cola| PickAlert
        Persist -->|Cola vacía| DS[📈 Data Scientist<br/>ML Tendencias & Feriados]
        DS --> EndFlow([🏁 Fin del Ciclo])
    end
```

---

## 🧠 Ciclos y Loops de la Ingeniería de Grafos (LangGraph)

1. **Loop de Refinamiento y Auto-Corrección (Self-Correction Loop):**
   - Si los vuelos encontrados superan el presupuesto por un margen estrecho o no hay opciones con pocas escalas, el Agente Crítico razona: *"Tarifa supera presupuesto por $120 USD. Mover salida 1 día antes suele abaratar la tarifa 25%"*.
   - El grafo se auto-corrige mediante una arista condicional hacia `refine_search_node`, adaptando las fechas y consultando nuevamente.
   - **Guardia de Seguridad:** Limitado a un máximo de 2 iteraciones (`max_iterations = 2`) para no quemar cuota ni tokens.
2. **Loop Multi-Alerta (Multi-Alert Iterator):**
   - El grafo no se detiene en la primera alerta; encola todas las alertas activas en Supabase (`alerts_queue`) y las procesa sucesivamente antes de pasar al nodo de Data Scientist.
3. **Escudo Híbrido de Cuota:**
   - **Playwright** scalpea directo a costo $0.
   - **Supabase** guarda estos hallazgos frescos.
   - **Python LangGraph** reutiliza primero los datos de Playwright a costo $0.
   - **SerpApi (250 búsquedas/mes, renueva el 23)** actúa como red de seguridad infalible en caso de fallo o refinamiento.

---

## 🛡️ Control de Cuotas y Rate Limits

| Servicio | Límite de Cuenta | Estrategia de Consumo |
| :--- | :--- | :--- |
| **SerpApi** | **250 búsquedas / mes** (renueva el **23 de cada mes**). | Escudo primario en Playwright ($0). SerpApi reservado para fallback y muestreo estadístico. |
| **Gemini AI Studio** | **20 RPD** (Requests por día), **5 RPM** (Free Tier). | **Batching obligatorio:** Se envían los vuelos en lote por alerta (1 call). Consumo real: 4 a 8 calls/día. Anti-crash a reglas heurísticas en caso de HTTP 429. |
| **Antigravity** | **100 RPD**, **60 RPM**. | Entorno de agentes de alta frecuencia. |

---

## 🛠 Stack Tecnológico

* **Automatización Web Headless:** `Playwright Extra` + `Puppeteer Stealth Plugin` + `Node.js / TypeScript`.
* **Motor de IA y Razonamiento:** `Google Gemini API` (`gemini-3.6-flash`, `gemini-2.5-flash`, `gemini-2.0-flash`, `gemini-1.5-flash`).
* **Ingeniería de Grafos (Backend):** `Python 3.11` + `LangGraph` + `LangChain` + `Pandas` + `Pydantic`.
* **Ciencia de Datos y Tendencias:** Regresión lineal (`numpy.polyfit`), medias móviles de 7 días, y detección automática de feriados (`holidays`).
* **Base de Datos & Auth:** `Supabase (PostgreSQL)` con Row Level Security (RLS) y campos deduplicados mediante hash MD5 (`hash_dedupe`).
* **Frontend Radar:** `Astro` + `TypeScript` + `Tailwind / Glassmorphism`, con despliegue en `Vercel`.
* **Notificaciones:** `Resend` para correos transaccionales y alertas inmediatas.
* **Orquestación Serverless:** `GitHub Actions` con workflows encadenados (`agent-hunt.yml` -> `pipeline.yml`).

---

## ⚙️ Estructura del Repositorio

```text
FLY-HUNTER/
├── .agents/                    # Memoria permanente y reglas para agentes de IA
│   └── rules/                  # Directivas de cuota, bugs resueltos y arquitectura
│       ├── bugs_y_arquitectura.md
│       ├── gemini-ai-quotas-and-limits.md
│       └── serpapi-quota-sampling.md
├── .github/workflows/          # Workflows serverless en GitHub Actions
│   ├── agent-hunt.yml          # Corre el agente de Playwright (TypeScript)
│   └── pipeline.yml            # Corre el grafo de LangGraph (Python)
├── agent/                      # Motor 1: Scalper Headless & Evaluador Gemini
│   ├── src/skills/googleFlights.ts
│   ├── src/skills/despegar.ts
│   ├── src/agent/geminiEvaluator.ts
│   └── src/index.ts
├── backend/                    # Motor 2: Grafo Cíclico en LangGraph
│   └── src/
│       ├── agents/             # Estratega, Recolector, Crítico LLM, Analista, Data Scientist
│       ├── services/           # DB Supabase y Notificaciones Resend
│       ├── graph.py            # Grafo de estados con loops y aristas condicionales
│       └── main.py             # Entrypoint del pipeline
├── frontend/                   # Radar Web en Astro
└── schema.sql                  # Definición de tablas en Supabase
```

---

## 🚀 Despliegue y Variables de Entorno

### Secrets requeridos en GitHub Actions:
* `SUPABASE_URL`: URL del proyecto en Supabase.
* `SUPABASE_SERVICE_ROLE_KEY`: Service Role Key para operaciones administrativas del backend.
* `GEMINI_API_KEY`: API Key de Google AI Studio para evaluación inteligente.
* `SERPAPI_KEY`: Clave de SerpApi (250 búsquedas/mes).
* `RESEND_API_KEY`: Clave para envío de alertas por correo electrónico.
* `ALERT_EMAIL_TO`: Correo destinatario de las oportunidades de oro y tarifas error.