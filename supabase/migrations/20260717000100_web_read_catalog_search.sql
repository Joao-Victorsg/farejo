-- F3/T4 (#50): busca server-only, ordenações estáveis e paginação no read model.
-- A role web recebe somente resultados já classificados; nomes brutos de aliases
-- nunca atravessam o DTO público.

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

grant select on table public.store_aliases to farejo_web_read_owner;
grant usage on schema extensions to farejo_web_read_owner;

create policy web_read_owner_select_store_aliases on public.store_aliases
  for select to farejo_web_read_owner using (true);

set role farejo_web_read_owner;

create function web_read.normalize_catalog_search(value text)
returns text
language sql
stable
strict
set search_path = pg_catalog, extensions
as $$
  select regexp_replace(
    replace(replace(lower(extensions.unaccent(value)), '+', 'plus'), '&', 'e'),
    '[^a-z0-9]+',
    '',
    'g'
  );
$$;

create view web_read.catalog_search_terms
with (security_barrier = true, security_invoker = false)
as
select catalog_stores.slug as store_slug, web_read.normalize_catalog_search(catalog_stores.name) as term, 'canonical'::text as source
from web_read.catalog_stores
union all
select catalog_stores.slug as store_slug, web_read.normalize_catalog_search(catalog_stores.slug) as term, 'slug'::text as source
from web_read.catalog_stores
union all
select catalog_stores.slug as store_slug, web_read.normalize_catalog_search(store_aliases.raw_name) as term, 'alias'::text as source
from web_read.catalog_stores
join public.stores on stores.slug = catalog_stores.slug
join public.store_aliases on store_aliases.store_id = stores.id;

create function web_read.catalog_search(search_query text, requested_sort text, requested_page integer)
returns table (
  slug text,
  name text,
  logo_url text,
  platform_count integer,
  relevance integer,
  total_count integer
)
language sql
stable
security definer
set search_path = web_read, pg_catalog, extensions
as $$
  with query_input as (
    select
      web_read.normalize_catalog_search(coalesce(search_query, '')) as normalized_query,
      case when requested_sort in ('platforms', 'cashback', 'az') then requested_sort else 'platforms' end as normalized_sort,
      greatest(coalesce(requested_page, 1), 1) as page_number
  ),
  matched_stores as (
    select
      catalog_stores.slug,
      catalog_stores.name,
      catalog_stores.logo_url,
      catalog_stores.platform_count,
      min(case
        when query_input.normalized_query = '' then 0
        when catalog_search_terms.source in ('canonical', 'slug')
          and catalog_search_terms.term = query_input.normalized_query then 0
        when catalog_search_terms.source = 'alias' and catalog_search_terms.term = query_input.normalized_query then 1
        when catalog_search_terms.term like query_input.normalized_query || '%' then 2
        when catalog_search_terms.term like '%' || query_input.normalized_query || '%' then 3
        when length(query_input.normalized_query) >= 3
          and extensions.similarity(catalog_search_terms.term, query_input.normalized_query) >= 0.3 then 4
      end) as relevance
    from web_read.catalog_stores
    cross join query_input
    join web_read.catalog_search_terms on catalog_search_terms.store_slug = catalog_stores.slug
    where query_input.normalized_query = ''
      or catalog_search_terms.term like query_input.normalized_query || '%'
      or catalog_search_terms.term like '%' || query_input.normalized_query || '%'
      or (length(query_input.normalized_query) >= 3 and extensions.similarity(catalog_search_terms.term, query_input.normalized_query) >= 0.3)
    group by catalog_stores.slug, catalog_stores.name, catalog_stores.logo_url, catalog_stores.platform_count
  ),
  ranked_stores as (
    select
      matched_stores.*,
      max(catalog_offers.value) filter (where catalog_offers.reward_type = 'percent') as best_percent,
      max(catalog_offers.value) filter (where catalog_offers.reward_type = 'fixed') as best_fixed
    from matched_stores
    join web_read.catalog_offers on catalog_offers.store_slug = matched_stores.slug
    group by matched_stores.slug, matched_stores.name, matched_stores.logo_url, matched_stores.platform_count, matched_stores.relevance
  ),
  ordered_stores as (
    select
      ranked_stores.*,
      count(*) over ()::integer as total_count,
      row_number() over (
        order by
          ranked_stores.relevance asc,
          case when query_input.normalized_sort = 'cashback' and ranked_stores.best_percent is null then 1 else 0 end asc,
          case when query_input.normalized_sort = 'cashback' then ranked_stores.best_percent end desc nulls last,
          case when query_input.normalized_sort = 'cashback' and ranked_stores.best_percent is null then ranked_stores.best_fixed end desc nulls last,
          case when query_input.normalized_sort = 'cashback' then ranked_stores.platform_count end desc nulls last,
          case when query_input.normalized_sort = 'platforms' then ranked_stores.platform_count end desc nulls last,
          ranked_stores.name asc,
          ranked_stores.slug asc
      ) as position
    from ranked_stores
    cross join query_input
  )
  select slug, name, logo_url, platform_count, relevance, total_count
  from ordered_stores
  cross join query_input
  where ordered_stores.position > ((query_input.page_number - 1) * 24)
    and ordered_stores.position <= (query_input.page_number * 24)
  order by ordered_stores.position;
$$;

reset role;

revoke all on function web_read.normalize_catalog_search(text) from public, anon, authenticated;
revoke all on table web_read.catalog_search_terms from public, anon, authenticated;
revoke all on function web_read.catalog_search(text, text, integer) from public, anon, authenticated;
grant execute on function web_read.catalog_search(text, text, integer) to farejo_web;
