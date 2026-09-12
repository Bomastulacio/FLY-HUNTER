-- Run once on an existing database before deploying the updated collectors.
-- Additive only: keep historical quotes; NULL means evidence was not recorded.
begin;
alter table public.flight_deals add column if not exists detalle_cotizacion jsonb;
alter table if exists public.saved_deals add column if not exists detalle_cotizacion jsonb;
comment on column public.flight_deals.detalle_cotizacion is
  'Observed quote evidence: priceBasis, passengersVerified, itineraryScope, stopsPerDirection, observedAt, paymentCondition. No credentials or raw HTML.';
commit;
