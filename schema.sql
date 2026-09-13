create extension if not exists pgcrypto;
-- Complete a fresh installation with schema_monitoring.sql (private monitoring tables).

create table public.flight_deals (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    ida_fecha date not null,
    ida_origen_destino text not null, -- ej. "EZE-MAD"
    vuelta_fecha date not null,
    vuelta_origen_destino text not null, -- ej. "CDG-EZE"
    precio_total_usd numeric(10,2) not null, -- precio total cotizado para los pasajeros indicados
    pasajeros int not null default 1, -- cantidad exacta de pasajeros para los que se cotizó la tarifa
    precio_por_pasajero_usd numeric(10,2), -- precio unitario calculado por pasajero
    precio_original numeric(12,2), -- precio en moneda local devuelto por aerolínea
    moneda_original text, -- ej. 'ARS', 'EUR', 'USD'
    precio_ars_tarjeta numeric(12,2), -- precio total calculado al dolar tarjeta
    aerolinea text,
    cantidad_escalas int not null default 0,
    duracion_total_minutos int,
    es_oportunidad_oro boolean not null default false, -- precio < umbral crítico
    es_anomalia boolean not null default false, -- rompe parámetros, necesita aprobación
    es_tarifa_error boolean not null default false,
    estado_aprobacion text not null default 'no_aplica', -- no_aplica | pendiente | aprobado | rechazado
    notificado boolean not null default false, -- evita reenviar el mismo mail
    fuente text, -- 'amadeus' | 'fli' | 'google_flights' | 'despegar' | 'serpapi'
    link_reserva text,
    detalle_cotizacion jsonb, -- base del precio, condiciones de pago y evidencia observada
    es_feriado_origen boolean not null default false,
    es_feriado_destino boolean not null default false,
    hash_dedupe text unique -- md5(ida_fecha || ida_od || vuelta_fecha || vuelta_od || aerolinea || round(precio) || pasajeros)
);

create index idx_flight_deals_precio on public.flight_deals (precio_total_usd);
create index idx_flight_deals_estado on public.flight_deals (estado_aprobacion);

-- Habilitar RLS (Row Level Security)
alter table public.flight_deals enable row level security;

-- Política para que los usuarios (lectura anónima del frontend) puedan ver las ofertas
create policy "Permitir lectura pública de ofertas"
    on public.flight_deals
    for select
    using (true);

-- Política para que el service_role (backend/API) pueda insertar/actualizar
create policy "Permitir full access al service role"
    on public.flight_deals
    using (auth.jwt() ->> 'role' = 'service_role');

-- Tabla de Insights (Data Science)
create table public.route_insights (
    ruta text primary key, -- ej. "EZE-MAD"
    precio_promedio_7d numeric(10,2),
    minimo_historico numeric(10,2),
    tendencia numeric(10,4), -- slope from linear regression
    actualizado_en timestamptz not null default now()
);

alter table public.route_insights enable row level security;

create policy "Permitir lectura pública de insights"
    on public.route_insights
    for select
    using (true);

create policy "Permitir full access al service role insights"
    on public.route_insights
    using (auth.jwt() ->> 'role' = 'service_role');

-- Tabla de Alertas de Búsqueda (Preferencias de usuario)
create table public.search_alerts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) not null,
    nombre text default 'Mi Radar',
    origen text not null,
    destino text not null,
    tipo_viaje text not null default 'ida_vuelta',
    fecha_ida_min date,
    fecha_ida_max date,
    fecha_vuelta_min date,
    fecha_vuelta_max date,
    paises text[],
    aerolineas_excluidas text[],
    pasajeros int default 1,
    presupuesto_min numeric(10,2),
    presupuesto_max numeric(10,2),
    escalas_max int default 1,
    clase text default 'Cualquiera',
    email text not null,
    activo boolean not null default true,
    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now()
    -- Soporta múltiples búsquedas activas por usuario (sin unique constraint)
);

-- Habilitar RLS
alter table public.search_alerts enable row level security;

-- Política para que los usuarios puedan ver y editar SUS propias alertas
create policy "Usuarios ven sus alertas"
    on public.search_alerts
    for select
    using (auth.uid() = user_id);

create policy "Usuarios editan sus alertas"
    on public.search_alerts
    for all
    using (auth.uid() = user_id);

create policy "Permitir full access al service role alertas"
    on public.search_alerts
    using (auth.jwt() ->> 'role' = 'service_role');

-- =====================================================================
-- Tabla de Vuelos Guardados (Favoritos permanentes vinculados a la cuenta)
-- =====================================================================
create table if not exists public.saved_deals (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete cascade not null,
    flight_deal_id uuid references public.flight_deals(id) on delete set null,
    origen text not null,
    destino text not null,
    ida_fecha date not null,
    vuelta_fecha date not null,
    pasajeros int not null default 1,
    precio_total_usd numeric(10,2) not null,
    precio_por_pasajero_usd numeric(10,2),
    aerolinea text,
    cantidad_escalas int default 0,
    fuente text,
    link_reserva text,
    creado_en timestamptz not null default now(),
    guardado_el timestamptz not null default now(),
    detalle_cotizacion jsonb,
    unique(user_id, origen, destino, ida_fecha, vuelta_fecha, pasajeros, aerolinea)
);

create index if not exists idx_saved_deals_user on public.saved_deals (user_id);
alter table public.saved_deals enable row level security;

create policy "Usuarios gestionan sus propios guardados"
    on public.saved_deals
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "Permitir full access al service role saved_deals"
    on public.saved_deals
    using (auth.jwt() ->> 'role' = 'service_role');

-- =====================================================================
-- MIGRACIONES SQL RECOMENDADAS PARA BASES DE DATOS EXISTENTES
-- =====================================================================
-- ALTER TABLE public.flight_deals ADD COLUMN IF NOT EXISTS pasajeros int NOT NULL DEFAULT 1;
-- ALTER TABLE public.flight_deals ADD COLUMN IF NOT EXISTS precio_por_pasajero_usd numeric(10,2);
