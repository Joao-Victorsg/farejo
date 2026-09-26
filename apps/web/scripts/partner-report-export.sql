-- Execute no SQL Editor do Supabase e exporte o resultado como CSV.
-- A consulta não retorna eventos individuais, apenas contadores agregados.
with cutover as (
  select clean_from from public.activation_metrics_cutover where singleton = true
)
select
  'cutover'::text as record_type,
  cutover.clean_from,
  null::date as day,
  null::text as store_slug,
  null::text as store_name,
  null::text as platform_id,
  null::text as platform_name,
  null::integer as activations
from cutover
union all
select
  'activation'::text as record_type,
  cutover.clean_from,
  metrics.day,
  stores.slug as store_slug,
  stores.name as store_name,
  platforms.id as platform_id,
  platforms.name as platform_name,
  metrics.activations
from public.activation_metrics as metrics
cross join cutover
join public.stores on stores.id = metrics.store_id
join public.platforms on platforms.id = metrics.platform_id
union all
select
  'smoke'::text as record_type,
  cutover.clean_from,
  smoke.day,
  null::text as store_slug,
  null::text as store_name,
  null::text as platform_id,
  null::text as platform_name,
  smoke.activations
from public.activation_smoke_metrics as smoke
cross join cutover
order by day nulls first, record_type, store_slug, platform_id;
