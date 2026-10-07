-- Mantém platform_stats(text[]) para deployments antigos; v2 acrescenta o slug que sustenta o pico.
set role farejo_web_read_owner;

create function web_read.platform_stats_v2(store_slugs text[] default null)
returns table (
  platform_id text,
  platform_name text,
  store_count integer,
  percent_avg double precision,
  percent_max double precision,
  percent_max_is_upto boolean,
  percent_max_store_slug text
)
language sql
stable
security definer
set search_path = web_read, pg_catalog
as $$
  with canonical_platforms (id) as (
    values ('meliuz'), ('cuponomia'), ('mycashback'), ('zoom'), ('inter')
  ),
  scoped_offers as (
    select *
    from web_read.catalog_offers
    where store_slugs is null or store_slug = any(store_slugs)
  ),
  coverage as (
    select platform_id, count(distinct store_slug)::integer as store_count
    from scoped_offers
    group by platform_id
  ),
  percent_offers as (
    select * from scoped_offers where reward_type = 'percent'
  ),
  percent_agg as (
    select platform_id, avg(value) as percent_avg, max(value) as percent_max
    from percent_offers
    group by platform_id
  ),
  percent_peak as (
    select distinct on (platform_id)
      platform_id, is_upto as percent_max_is_upto, store_slug as percent_max_store_slug
    from percent_offers
    order by platform_id, value desc, is_upto asc, store_slug asc
  )
  select
    canonical_platforms.id as platform_id,
    platforms.name as platform_name,
    coalesce(coverage.store_count, 0) as store_count,
    percent_agg.percent_avg,
    percent_agg.percent_max,
    percent_peak.percent_max_is_upto,
    percent_peak.percent_max_store_slug
  from canonical_platforms
  join public.platforms on platforms.id = canonical_platforms.id
  left join coverage on coverage.platform_id = canonical_platforms.id
  left join percent_agg on percent_agg.platform_id = canonical_platforms.id
  left join percent_peak on percent_peak.platform_id = canonical_platforms.id
  order by platforms.name;
$$;

revoke all on function web_read.platform_stats_v2(text[]) from public, anon, authenticated;
grant execute on function web_read.platform_stats_v2(text[]) to farejo_web;

set role postgres;
