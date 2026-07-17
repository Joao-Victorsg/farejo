-- F3/T5 (#51): detalhe canônico sem expor URLs externas ou dados operacionais.

set role farejo_web_read_owner;

create or replace view web_read.catalog_offers
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
  end as freshness,
  offers.last_seen_at
from public.offers
join public.stores on stores.id = offers.store_id
join public.platforms on platforms.id = offers.platform_id
where offers.active = true
  and offers.last_seen_at >= now() - interval '48 hours';

create view web_read.store_details
with (security_barrier = true, security_invoker = false)
as
select
  stores.slug,
  stores.name,
  stores.logo_url,
  count(distinct catalog_offers.platform_id)::integer as platform_count
from public.stores
left join web_read.catalog_offers on catalog_offers.store_slug = stores.slug
group by stores.slug, stores.name, stores.logo_url;

reset role;

revoke all on table web_read.store_details from public, anon, authenticated;
grant select on table web_read.store_details to farejo_web;
