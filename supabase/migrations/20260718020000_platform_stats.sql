-- F3/T10 (#56, ADR-0019/ADR-0020): estatísticas reais de `/plataformas`.
--
-- Cobertura conta lojas distintas com QUALQUER oferta elegível (percent ou fixed) por
-- plataforma. Média e pico usam somente ofertas `percent`, cada loja com peso igual — a
-- mesma janela de frescor/ativa de `web_read.catalog_offers`, então a página compartilha
-- cache e frescor com o catálogo (ADR-0008). Valor fixo nunca entra em média/pico e nunca é
-- convertido. O Inter usa sempre `value` (correntista, ADR-0020) — `value_partial` nunca
-- aparece aqui, catalog_offers já não expõe outra coluna para este cálculo.
--
-- `store_slugs` (default null = todo o catálogo) segue o mesmo padrão de
-- `web_read.catalog_history` (20260718010000): produção nunca passa argumento; os testes
-- escopam a fixtures próprias sem depender do estado global do banco compartilhado.
--
-- Desempate do pico (ADR-0019 preserva `is_upto` do vencedor): valor desc primeiro; em
-- empate, uma taxa garantida (`is_upto = false`) vence sobre um teto “até”; em empate
-- remanescente, `store_slug` asc garante um resultado determinístico.
--
-- As 5 plataformas canônicas ficam fixas em `canonical_platforms`, não em "select de
-- public.platforms": o AC exige que `/plataformas` mostre só Méliuz/Cuponomia/MyCashback/
-- Zoom/Inter, e `public.platforms` não tem nenhuma restrição que impeça outra linha (ex.:
-- fixtures de teste de outro pacote) de aparecer ali.

set role farejo_web_read_owner;

create function web_read.platform_stats(store_slugs text[] default null)
returns table (
  platform_id text,
  platform_name text,
  store_count integer,
  percent_avg double precision,
  percent_max double precision,
  percent_max_is_upto boolean
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
    select distinct on (platform_id) platform_id, is_upto as percent_max_is_upto
    from percent_offers
    order by platform_id, value desc, is_upto asc, store_slug asc
  )
  select
    canonical_platforms.id as platform_id,
    platforms.name as platform_name,
    coalesce(coverage.store_count, 0) as store_count,
    percent_agg.percent_avg,
    percent_agg.percent_max,
    percent_peak.percent_max_is_upto
  from canonical_platforms
  join public.platforms on platforms.id = canonical_platforms.id
  left join coverage on coverage.platform_id = canonical_platforms.id
  left join percent_agg on percent_agg.platform_id = canonical_platforms.id
  left join percent_peak on percent_peak.platform_id = canonical_platforms.id
  order by platforms.name;
$$;

reset role;

revoke all on function web_read.platform_stats(text[]) from public, anon, authenticated;
grant execute on function web_read.platform_stats(text[]) to farejo_web;
