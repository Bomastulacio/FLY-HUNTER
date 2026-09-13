-- Phase 1 monitoring. Run after schema.sql / schema_quote_evidence.sql.
-- Additive, repeatable; existing deals, approvals and notification flags are preserved.
begin;

create table if not exists public.radar_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  primary_radar_id uuid references public.search_alerts(id) on delete set null
);
alter table public.radar_preferences enable row level security;
revoke all on public.radar_preferences from anon, authenticated;
grant select, insert, update, delete on public.radar_preferences to authenticated;
grant all on public.radar_preferences to service_role;
drop policy if exists radar_preferences_owner on public.radar_preferences;
create policy radar_preferences_owner on public.radar_preferences for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and (primary_radar_id is null or exists (
    select 1 from public.search_alerts r where r.id = primary_radar_id and r.user_id = (select auth.uid())
  )));
create index if not exists radar_preferences_primary_idx on public.radar_preferences(primary_radar_id);

create table if not exists public.saved_deal_checks (
  event_id text primary key check (event_id ~ '^[a-f0-9]{64}$'),
  saved_deal_id uuid not null references public.saved_deals(id) on delete cascade,
  provider text not null check (provider in ('google_flights', 'despegar')),
  checked_at timestamptz not null,
  outcome text not null check (outcome in ('observed', 'not_observed', 'unverified', 'blocked', 'error')),
  quote jsonb,
  check ((outcome = 'observed' and quote is not null and jsonb_typeof(quote) = 'object')
    or (outcome <> 'observed' and quote is null))
);
create index if not exists saved_deal_checks_latest_idx on public.saved_deal_checks(saved_deal_id, checked_at desc);
alter table public.saved_deal_checks enable row level security;
revoke all on public.saved_deal_checks from anon, authenticated;
grant select on public.saved_deal_checks to authenticated;
grant all on public.saved_deal_checks to service_role;
drop policy if exists saved_deal_checks_owner on public.saved_deal_checks;
create policy saved_deal_checks_owner on public.saved_deal_checks for select to authenticated
  using (exists (select 1 from public.saved_deals s where s.id = saved_deal_id and s.user_id = (select auth.uid())));

create or replace view public.saved_deal_latest with (security_invoker = true) as
  select latest.*, last_seen.quote as last_quote, last_seen.checked_at as last_observed_at
  from (select distinct on (saved_deal_id) * from public.saved_deal_checks
    order by saved_deal_id, checked_at desc, event_id desc) latest
  left join lateral (select c.quote, c.checked_at from public.saved_deal_checks c
    where c.saved_deal_id = latest.saved_deal_id and c.outcome = 'observed'
    order by c.checked_at desc, c.event_id desc limit 1) last_seen on true;
revoke all on public.saved_deal_latest from anon, authenticated;
grant select on public.saved_deal_latest to authenticated, service_role;

create table if not exists public.radar_scan_status (
  radar_id uuid not null references public.search_alerts(id) on delete cascade,
  provider text not null check (provider in ('google_flights', 'despegar')),
  checked_at timestamptz not null,
  outcome text not null check (outcome in ('ok', 'empty', 'unverified', 'blocked', 'error', 'deferred')),
  checked_combinations integer not null check (checked_combinations >= 0),
  total_combinations integer not null check (total_combinations > 0),
  primary key (radar_id, provider),
  check (checked_combinations <= total_combinations)
);
alter table public.radar_scan_status enable row level security;
revoke all on public.radar_scan_status from anon, authenticated;
grant select on public.radar_scan_status to authenticated;
grant all on public.radar_scan_status to service_role;
drop policy if exists radar_scan_status_owner on public.radar_scan_status;
create policy radar_scan_status_owner on public.radar_scan_status for select to authenticated
  using (exists (select 1 from public.search_alerts r where r.id = radar_id and r.user_id = (select auth.uid())));
create index if not exists flight_deals_recent_idx on public.flight_deals(created_at desc);
commit;
