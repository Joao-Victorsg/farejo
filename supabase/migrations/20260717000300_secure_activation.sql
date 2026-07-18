-- F3/T6 (#52): revalidação de ativação e telemetria diária, separadas do read model público.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'farejo_activation_owner') then
    create role farejo_activation_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'farejo_activation') then
    create role farejo_activation login noinherit nosuperuser nocreatedb nocreaterole noreplication;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'farejo_metrics_owner') then
    create role farejo_metrics_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'farejo_metrics') then
    create role farejo_metrics login noinherit nosuperuser nocreatedb nocreaterole noreplication;
  end if;
end;
$$;

grant farejo_activation_owner, farejo_activation, farejo_metrics_owner, farejo_metrics to postgres;

alter role farejo_activation set statement_timeout = '1500ms';
alter role farejo_activation set lock_timeout = '1500ms';
alter role farejo_activation set search_path = activation, pg_catalog;
alter role farejo_metrics set statement_timeout = '1500ms';
alter role farejo_metrics set lock_timeout = '1500ms';
alter role farejo_metrics set search_path = activation, pg_catalog;

create schema if not exists activation authorization farejo_activation_owner;
revoke all on schema activation from public, anon, authenticated, farejo_web;
grant usage on schema activation to farejo_activation, farejo_metrics;
grant usage, create on schema activation to farejo_metrics_owner;
alter default privileges for role farejo_activation_owner in schema activation revoke execute on functions from public;
alter default privileges for role farejo_metrics_owner in schema activation revoke execute on functions from public;

grant usage on schema public to farejo_activation_owner, farejo_metrics_owner;
grant usage on schema public to farejo_metrics;
grant select (id, slug) on public.stores to farejo_activation_owner;
grant select (store_id, platform_id, url, active, last_seen_at) on public.offers to farejo_activation_owner;
grant select (id, base_url) on public.platforms to farejo_activation_owner;

create policy activation_owner_select_stores on public.stores
  for select to farejo_activation_owner using (true);
create policy activation_owner_select_offers on public.offers
  for select to farejo_activation_owner using (true);
create policy activation_owner_select_platforms on public.platforms
  for select to farejo_activation_owner using (true);

-- A chave única de offers já atende (store_id, platform_id); este índice parcial mantém o
-- lookup de ativação pequeno e cobre a verificação de frescor e destino sem abrir o read model.
create index idx_offers_activation_eligible
  on public.offers (store_id, platform_id, last_seen_at desc)
  include (url)
  where active = true;

create function activation.resolve_destination(requested_store_slug text, requested_platform_id text)
returns table (store_id bigint, destination text)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select stores.id, offers.url
  from public.stores
  join public.offers on offers.store_id = stores.id
  join public.platforms on platforms.id = offers.platform_id
  where stores.slug = requested_store_slug
    and offers.platform_id = requested_platform_id
    and offers.active = true
    and offers.last_seen_at >= current_timestamp - interval '48 hours'
    and (lower(offers.url) = lower(platforms.base_url) or lower(offers.url) like lower(platforms.base_url) || '/%')
  limit 1;
$$;
alter function activation.resolve_destination(text, text) owner to farejo_activation_owner;
revoke all on function activation.resolve_destination(text, text) from public, anon, authenticated, farejo_web, farejo_metrics;
grant execute on function activation.resolve_destination(text, text) to farejo_activation;

create table public.activation_metrics (
  day date not null default current_date,
  store_id bigint not null references public.stores(id),
  platform_id text not null references public.platforms(id),
  activations integer not null default 0 check (activations >= 0),
  primary key (day, store_id, platform_id)
);
alter table public.activation_metrics enable row level security;
revoke all on table public.activation_metrics from public, anon, authenticated, farejo_web, farejo_activation, farejo_metrics;
grant select, insert, update on table public.activation_metrics to farejo_metrics;
create policy metrics_owner_write_aggregate on public.activation_metrics
  for all to farejo_metrics_owner using (true) with check (true);
create policy metrics_role_read_aggregate on public.activation_metrics
  for select to farejo_metrics using (true);
create policy metrics_role_write_aggregate on public.activation_metrics
  for insert to farejo_metrics with check (true);
create policy metrics_role_update_aggregate on public.activation_metrics
  for update to farejo_metrics using (true) with check (true);

create function activation.record_activation(requested_store_id bigint, requested_platform_id text)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  insert into public.activation_metrics (day, store_id, platform_id, activations)
  values (current_date, requested_store_id, requested_platform_id, 1)
  on conflict (day, store_id, platform_id)
  do update set activations = public.activation_metrics.activations + 1;
end;
$$;
alter function activation.record_activation(bigint, text) owner to farejo_metrics_owner;
revoke all on function activation.record_activation(bigint, text) from public, anon, authenticated, farejo_web, farejo_activation;
grant execute on function activation.record_activation(bigint, text) to farejo_metrics;
