create extension if not exists pgcrypto;

create table public.flight_deals (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    ida_fecha date not null,
    ida_origen_destino text not null, -- ej. "EZE-MAD"
    vuelta_fecha date not null,
    vuelta_origen_destino text not null, -- ej. "CDG-EZE"
    precio_total_usd numeric(10,2) not null, -- total para 2 pasajeros (convertido a usd)
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
    fuente text, -- 'amadeus' | 'fli'
    link_reserva text,
    es_feriado_origen boolean not null default false,
    es_feriado_destino boolean not null default false,
    hash_dedupe text unique -- md5(ida_fecha || ida_od || vuelta_fecha || vuelta_od || aerolinea || round(precio))
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
