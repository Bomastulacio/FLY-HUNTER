# Flight Hunter

Un sistema proactivo de rastreo y alerta de vuelos construido para encontrar pasajes económicos hacia Europa y Asia. 

## Historia del Proyecto

La idea de este proyecto nació de una necesidad real: planear unas vacaciones con mi novia. Buscar pasajes manualmente todos los días, comparar precios y estar pendiente de las ofertas relámpago se vuelve una tarea exhaustiva. En lugar de depender de alertas genéricas de sitios de viajes, decidí construir una solución propia, ajustada exactamente a nuestras fechas, presupuestos y destinos.

Además del objetivo personal de conseguir vuelos baratos, este proyecto sirvió como excusa perfecta para poner a prueba y consolidar varias herramientas y arquitecturas de software que estuve aprendiendo recientemente. Aquí está el resultado.

## ¿Qué hace Flight Hunter?

Flight Hunter es una aplicación full-stack que opera de forma autónoma. No espera a que un usuario busque vuelos; los busca de forma periódica, los evalúa con un motor de reglas de negocio y notifica cuando hay oportunidades reales.

### Características Principales

- **Búsqueda Automatizada:** Scraping/búsqueda de vuelos usando `fli` (un envoltorio sobre APIs internas) hacia destinos específicos: Madrid, París, Londres (Europa) y Tokio, Osaka (Asia).
- **Filtros Específicos:** Monitoreo especial para vuelos operados exclusivamente por Lufthansa.
- **Motor de Reglas (Crítico):** 
  - *Oportunidades de Oro:* Si el vuelo total para 2 personas baja de $1500 USD, se envía un correo inmediatamente.
  - *Aprobaciones Estándar:* Ofertas dentro de un presupuesto razonable ($1700 - $2400) con fechas exactas.
  - *Anomalías:* Ofertas muy económicas pero que varían ligeramente en la fecha o en la cantidad de escalas. Quedan en estado "Pendiente" para aprobación humana.
- **Human-in-the-Loop:** Un panel web donde se pueden revisar y aprobar/rechazar las anomalías detectadas, lo cual reanuda el ciclo de búsqueda.

## Arquitectura y Stack Tecnológico

El sistema fue diseñado priorizando la eficiencia, los bajos costos (serverless) y la simplicidad operativa.

- **Orquestación y Lógica (Backend):** 
  - **Python + LangGraph:** Estructura de agentes modulares (Supervisor, Recolectores, Analista, Crítico).
  - **Pandas:** Para limpieza de datos, consolidación y manejo eficiente de tablas en memoria.
  - **GitHub Actions:** Actúa como el motor de ejecución (cron job) cada 6 horas. Esto evita mantener un servidor 24/7 y permite ejecuciones prolongadas sin límite de timeout corto.
- **Almacenamiento (Base de Datos):** 
  - **Supabase (PostgreSQL):** Base de datos relacional para persistir ofertas. Cuenta con validación estricta, un sistema de hashes MD5 para evitar ofertas duplicadas y políticas RLS (Row Level Security).
- **Interfaz de Usuario (Frontend):** 
  - **Astro:** Un framework web enfocado en la velocidad. 
  - **Vercel:** Despliegue del sitio y alojamiento del endpoint Serverless (API) necesario para aprobar las anomalías e interactuar con GitHub Actions vía `repository_dispatch`.
- **Notificaciones:**
  - **Resend:** Utilizado para enviar correos electrónicos transaccionales cuando se encuentran ofertas clave.

## Estructura del Repositorio

- `/backend`: Contiene toda la lógica de obtención, análisis y filtrado de vuelos en Python. El pipeline se ejecuta mediante `main.py`.
- `/frontend`: Proyecto web construido en Astro. Incluye un dashboard estilo Bento Grid para visualizar el estado actual de las ofertas.
- `.github/workflows`: Definición de la pipeline de integración continua que ejecuta las búsquedas periódicas.
- `schema.sql`: Script DDL para replicar la estructura y reglas de seguridad de la base de datos en Supabase.
- `agents.md`: Archivo de contexto fundacional del proyecto.

## Instalación y Despliegue

1. **Base de Datos:** Crear un proyecto en Supabase y ejecutar el archivo `schema.sql` en el SQL Editor.
2. **Entorno Local (Backend):**
   - Navegar a `/backend` e instalar dependencias con `pip install -r requirements.txt`.
   - Crear un archivo `.env` con las claves de Supabase (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) y Resend (`RESEND_API_KEY`).
3. **Entorno Local (Frontend):**
   - Navegar a `/frontend` e instalar dependencias con `npm install`.
   - Levantar el entorno con `npm run dev`.
4. **Despliegue Nube:**
   - Cargar los Secrets correspondientes en los settings del repositorio de GitHub (para que el cron funcione).
   - Vincular la carpeta `/frontend` a un proyecto en Vercel.

---

Desarrollado para resolver un problema real, aprendiendo en el proceso.