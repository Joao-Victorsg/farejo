-- F3/T2 (#48): contrato de leitura server-only para o catálogo público.
-- `farejo_web` só recebe SELECT nas views estreitas de `web_read`; o browser
-- continua sem acesso à Data API e às tabelas operacionais.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'farejo_web_read_owner') then
    create role farejo_web_read_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'farejo_web') then
    create role farejo_web login noinherit nosuperuser nocreatedb nocreaterole noreplication;
  end if;
end;
$$;

grant farejo_web_read_owner, farejo_web to postgres;

alter role farejo_web login;
alter role farejo_web set statement_timeout = '3s';
alter role farejo_web set search_path = web_read, pg_catalog;

-- `PUBLIC` recebe USAGE em schemas novos por padrão. Removemos essa herança para
-- que farejo_web não possa sequer resolver objetos operacionais em public.
revoke usage on schema public from public;
grant usage on schema public to service_role, farejo_web_read_owner;

grant select on table public.stores, public.offers, public.platforms to farejo_web_read_owner;

create policy web_read_owner_select_stores on public.stores
  for select to farejo_web_read_owner using (true);
create policy web_read_owner_select_offers on public.offers
  for select to farejo_web_read_owner using (true);
create policy web_read_owner_select_platforms on public.platforms
  for select to farejo_web_read_owner using (true);

create schema if not exists web_read authorization farejo_web_read_owner;
revoke all on schema web_read from public, anon, authenticated;
revoke all on all tables in schema web_read from public, anon, authenticated;

set role farejo_web_read_owner;

create view web_read.catalog_offers
with (security_barrier = true, security_invoker = false)
as
select
  stores.slug as store_slug,
  platforms.id as platform_id,
  platforms.name as platform_name,
  offers.reward_type,
  offers.value::double precision as value,
  offers.value_partial::double precision as value_partial,
  coalesce(offers.is_upto, false) as is_upto,
  case
    when offers.last_seen_at >= now() - interval '24 hours' then 'fresh'
    else 'delayed'
  end as freshness
from public.offers
join public.stores on stores.id = offers.store_id
join public.platforms on platforms.id = offers.platform_id
where offers.active = true
  and offers.last_seen_at >= now() - interval '48 hours';

create view web_read.catalog_stores
with (security_barrier = true, security_invoker = false)
as
select
  catalog_offers.store_slug as slug,
  stores.name,
  stores.logo_url,
  count(distinct catalog_offers.platform_id)::integer as platform_count
from web_read.catalog_offers
join public.stores on stores.slug = catalog_offers.store_slug
group by catalog_offers.store_slug, stores.name, stores.logo_url;

reset role;

revoke all on all tables in schema web_read from public, anon, authenticated;
grant usage on schema web_read to farejo_web;
grant select on table web_read.catalog_offers, web_read.catalog_stores to farejo_web;

alter default privileges for role farejo_web_read_owner in schema web_read
  revoke all on tables from public, anon, authenticated;

create index idx_offers_active_last_seen_store_platform
  on public.offers (last_seen_at desc, store_id, platform_id)
  where active = true;
create index idx_stores_catalog_name_slug on public.stores (name, slug);
