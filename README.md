# 🛫 Fly Hunter

Un sistema proactivo de rastreo y alerta de vuelos construido sobre una arquitectura de **Inteligencia Artificial Agentiva (LangGraph)**. Diseñado para buscar de manera autónoma, evaluar mediante reglas de negocio complejas y notificar las mejores oportunidades de pasajes aéreos globales.

## 🎯 El Proyecto

Fly Hunter automatiza la búsqueda obsesiva de vuelos (como ir a Europa o Japón). A diferencia de las alertas genéricas comerciales, cuenta con un backend dotado de "agentes" que ejecutan scrapping, limpian datos con Pandas, evalúan lógicas difusas (como romper una regla de fecha levemente si el precio es una ganga) e incluyen validación humana (Human-in-the-Loop) cuando hace falta.

El sistema es robusto, completamente desatendido y multiusuario, integrando **Astro**, **Supabase**, y un motor **Serverless** ejecutado en **GitHub Actions**.

---

## 🏗 Arquitectura y Lógica del Grafo (LangGraph)

El "cerebro" del proyecto está orquestado mediante **LangGraph** en Python. El flujo arranca cada 6 horas y atraviesa un equipo de Agentes Especializados:

```mermaid
graph TD
    Trigger([🕒 GitHub Actions Cron<br>Cada 6 horas]) --> Sup
    
    subgraph Equipo de Recolección
        Sup[🤖 Supervisor<br>Recibe el Goal] -->|Delega| AE[🕵️ Subagente Europa]
        Sup -->|Delega| AA[🕵️ Subagente Asia]
        Sup -->|Delega| AC[🕵️ Subagente Capricho<br>Lufthansa]
    end

    AE --> Analista
    AA --> Analista
    AC --> Analista

    subgraph Procesamiento y Evaluación
        Analista[📊 Agente Analista<br>Pandas: Consolida y Normaliza] --> Critico
        Critico{🧐 Agente Crítico<br>Motor de Reglas}
    end

    Critico -->|Precio < $1500 USD| Oro[⭐ Oportunidad de Oro]
    Critico -->|Dentro de Presupuesto| OK[✅ Aprobado Estándar]
    Critico -->|Fuera de regla pero muy barato| Anomalia[⚠️ Anomalía Pendiente]

    Oro --> DB[(Supabase)]
    OK --> DB
    Anomalia --> DB

    subgraph Acciones Finales
        DB --> Notif{Gestor de Notificaciones}
        Notif -->|⭐ Oro| Email1[📧 Email Inmediato<br>¡Comprar ahora!]
        Notif -->|⚠️ Anomalía| Email2[📧 Email de Revisión<br>Human-in-the-Loop]
    end
```

### Roles de los Agentes Actuales:
1. **Supervisor**: Orquesta el trabajo inicial leyendo la configuración de alertas en base de datos.
2. **Subagentes Recolectores (Europa, Asia, Capricho)**: Consultan SerpApi (Google Flights) en sus dominios con manejo de cuota y retries.
3. **Agente Analista (Pandas)**: Consolida todos los JSON dispares en un dataset, calcula precios consolidados (ej. para múltiples pasajeros) y descarta rutas basura (vuelos con más de 1 escala se rechazan rotundamente).
4. **Agente Crítico (Motor de Decisión)**: 
   - Analiza el precio final contra el umbral crítico configurado (ej: `< $1500`). Si se cumple, lo clasifica como **Oportunidad de Oro**.
   - Analiza el rango de presupuesto. Si cumple, lo marca como **Aprobado**.
   - Si rompe fechas pero el precio es imperdible, lo etiqueta como **Anomalía** requiriendo que el usuario entre a la web y lo apruebe o rechace manualmente.

### Deduplicación de Vuelos (Hash Dedupe)
Un problema crítico resuelto es la duplicación de alertas. Cada vuelo procesado recibe un `hash_dedupe` único en base a sus características físicas (fechas, aerolínea, horarios, ruta). La base de datos (Supabase) usa un `UPSERT ON CONFLICT DO NOTHING`, asegurando que vuelos encontrados en corridas pasadas pero que siguen activos, solo actualicen su registro y no disparen notificaciones spam.

Además, los vuelos expiran orgánicamente: si un precio desaparece de Google Flights, el backend deja de encontrarlo y su fecha `created_at` o `updated_at` envejece; el frontend sólo muestra resultados con antigüedad menor a 24hs.

---

## 🛠 Stack Tecnológico

La lógica está acoplada usando herramientas que eliminan costos operativos continuos de servidor:

* **Backend & Orquestación**: `Python` + `LangGraph` + `Pandas`.
* **Motor de Ejecución**: `GitHub Actions` configurado con cron job (`workflow_dispatch` y `repository_dispatch` activados).
* **Base de Datos & Auth**: `Supabase (PostgreSQL)` con RLS y manejo separado de Service Role (backend) y Anon Key (frontend).
* **Datos de Vuelos**: `SerpApi (Google Flights API)` manejado determinísticamente (sin iteraciones aleatorias que gasten cuota innecesariamente).
* **Frontend y API**: `Astro` + `TypeScript`, alojado en `Vercel`. Con diseño Glassmorphism, iconografía Phosphor y una UI responsiva / Mobile First.
* **Notificaciones**: `Resend` (para correos transaccionales urgentes y alertas a los usuarios).

---

## ⚙️ Estructura del Sistema

- **`/backend`**: Todo el grafo de Python. En particular `/backend/src/agents/` contiene a todos los LLMs configurados como nodos.
- **`/frontend`**: Interfaz de "Radar" con Astro. Provee SSR para cargar datos en tiempo real de Supabase y contiene el endpoint de `Human-in-the-Loop` (`/api/aprobar-anomalia`).
- **`.github/workflows`**: Acciona la vida del backend. Recibe pings del Frontend para continuar flujos pausados (workflow events).
- **`schema.sql`**: Esquema DDL para replicar el modelo (alertas, configuración, historial de vuelos rastreados).

## 🚀 Despliegue

1. Base de datos: Ejecutar `schema.sql` en un nuevo proyecto en Supabase.
2. Vercel (Frontend): Subir la carpeta `/frontend`. Las variables requeridas son `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` y los TOKENS de GitHub/Admin.
3. GitHub Actions (Backend): Instanciar los secrets requeridos: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SERPAPI_KEY` y `RESEND_API_KEY`. El cron se encarga del resto.