-- Categorias curadas: nenhuma associação de pesquisa é publicada pela migration.
create table public.categories (
  slug text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(name) between 1 and 80),
  icon text not null,
  position integer not null check (position >= 0),
  active boolean not null default true
);
create table public.store_categories (
  store_id bigint not null references public.stores(id),
  category_slug text not null references public.categories(slug),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0),
  primary key (store_id, category_slug)
);
create index store_categories_category_store on public.store_categories (category_slug, store_id);
alter table public.categories enable row level security;
alter table public.store_categories enable row level security;
revoke all on public.categories, public.store_categories from public, anon, authenticated, farejo_web, service_role;
grant select on public.categories, public.store_categories to farejo_web_read_owner;
grant select, insert, update, delete on public.categories, public.store_categories to farejo_curation_owner;
create policy web_read_categories on public.categories for select to farejo_web_read_owner using (true);
create policy web_read_store_categories on public.store_categories for select to farejo_web_read_owner using (true);
create policy curation_categories on public.categories for all to farejo_curation_owner using (true) with check (true);
create policy curation_store_categories on public.store_categories for all to farejo_curation_owner using (true) with check (true);

set role farejo_web_read_owner;
create view web_read.catalog_categories with (security_barrier = true, security_invoker = false) as
select slug, name, icon, position from public.categories where active;
create view web_read.catalog_store_categories with (security_barrier = true, security_invoker = false) as
select stores.slug as store_slug, store_categories.category_slug
from public.store_categories
join public.stores on stores.id = store_categories.store_id
join public.categories on categories.slug = store_categories.category_slug
where categories.active;
reset role;
revoke all on web_read.catalog_categories, web_read.catalog_store_categories from public, anon, authenticated;
grant select on web_read.catalog_categories to farejo_web;

set role farejo_web_read_owner;
create function web_read.catalog_search(search_query text, requested_sort text, requested_page integer, requested_category text)
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
    where (requested_category is null or exists (
      select 1 from web_read.catalog_store_categories sc
      where sc.store_slug = catalog_stores.slug and sc.category_slug = requested_category
    )) and (query_input.normalized_query = ''
      or catalog_search_terms.term like query_input.normalized_query || '%'
      or catalog_search_terms.term like '%' || query_input.normalized_query || '%'
      or (length(query_input.normalized_query) >= 3 and extensions.similarity(catalog_search_terms.term, query_input.normalized_query) >= 0.3))
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
revoke all on function web_read.catalog_search(text, text, integer, text) from public, anon, authenticated;
grant execute on function web_read.catalog_search(text, text, integer, text) to farejo_web;

create or replace function curation.apply_alias_merge(
  p_canonical_slug text,
  p_aliases jsonb
) returns table (applied boolean, reason text, absorbed_slugs text[])
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_canonical_id      bigint;
  v_alias             jsonb;
  v_platform_id       text;
  v_raw_name          text;
  v_source_store_id   bigint;
  v_absorbed_ids      bigint[] := array[]::bigint[];
  v_absorbed_slugs    text[];
  v_conflict_platform text;
begin
  -- Serializa mudanças de identidade com a aplicação de categorias.
  perform pg_advisory_xact_lock(hashtextextended('farejo-curation', 0));
  select id into v_canonical_id from stores where slug = p_canonical_slug;
  if v_canonical_id is null then
    -- A loja canônica ainda não foi raspada: não é erro fatal do manifesto inteiro,
    -- só esta decisão fica pendente até o scraper criar a loja.
    return query select false, 'canonical_not_found'::text, null::text[];
    return;
  end if;

  -- Passo 1: candidatos de absorção SEM lock — só pra montar a lista de ids a travar.
  for v_alias in select * from jsonb_array_elements(p_aliases)
  loop
    v_platform_id := v_alias ->> 'platformId';
    v_raw_name    := v_alias ->> 'rawName';

    select store_id into v_source_store_id
      from store_aliases
      where platform_id = v_platform_id and raw_name = v_raw_name;

    if v_source_store_id is not null and v_source_store_id <> v_canonical_id
       and not (v_source_store_id = any(v_absorbed_ids)) then
      v_absorbed_ids := v_absorbed_ids || v_source_store_id;
    end if;
  end loop;

  -- Lock determinístico: uma única instrução, ordem ascendente de id, canônica +
  -- candidatas juntas. Consistente não importa qual chamada concorrente do mesmo
  -- cluster considera qual loja "canônica" — evita deadlock entre duas decisões que
  -- discordam sobre a direção do merge.
  perform 1 from stores where id = any(array[v_canonical_id] || v_absorbed_ids) order by id for update;

  -- Passo 2: re-resolve com lock seguro (fecha a janela TOCTOU do passo anterior) e já
  -- grava/confirma os aliases. absorbed_ids é reconstruído do zero a partir do estado
  -- agora travado — é a lista autoritativa usada dali em diante.
  v_absorbed_ids := array[]::bigint[];
  for v_alias in select * from jsonb_array_elements(p_aliases)
  loop
    v_platform_id := v_alias ->> 'platformId';
    v_raw_name    := v_alias ->> 'rawName';

    select store_id into v_source_store_id
      from store_aliases
      where platform_id = v_platform_id and raw_name = v_raw_name;

    if v_source_store_id is null then
      insert into store_aliases (platform_id, raw_name, store_id, confidence)
      values (v_platform_id, v_raw_name, v_canonical_id, 'confirmed')
      on conflict (platform_id, raw_name) do update set store_id = excluded.store_id, confidence = 'confirmed';
    else
      update store_aliases set confidence = 'confirmed'
        where platform_id = v_platform_id and raw_name = v_raw_name;
      if v_source_store_id <> v_canonical_id and not (v_source_store_id = any(v_absorbed_ids)) then
        v_absorbed_ids := v_absorbed_ids || v_source_store_id;
      end if;
    end if;
  end loop;

  if array_length(v_absorbed_ids, 1) is null then
    -- Convergência idempotente: nada a absorver (já fundido antes, ou aliases novos sem
    -- conflito nenhum foram só registrados acima).
    return query select true, 'noop'::text, array[]::text[];
    return;
  end if;

  select array_agg(slug) into v_absorbed_slugs from stores where id = any(v_absorbed_ids);

  -- Lock das ofertas do cluster ANTES da checagem: serializa contra um
  -- pipeline_write_offers concorrente que poderia inserir oferta nova no meio da
  -- checagem. FOR UPDATE não pode ser combinado com GROUP BY (abaixo), por isso o lock
  -- é uma instrução própria, separada da checagem agregada que o segue.
  perform 1 from offers where store_id = any(array[v_canonical_id] || v_absorbed_ids) for update;

  -- Falha fechada, sem escolher automaticamente qual observação da mesma plataforma é
  -- a "certa".
  select platform_id into v_conflict_platform
    from offers
    where store_id = any(array[v_canonical_id] || v_absorbed_ids)
    group by platform_id
    having count(distinct store_id) > 1
    limit 1;

  if v_conflict_platform is not null then
    raise exception
      'apply_alias_merge: canônico % (id=%) tem ofertas conflitantes de mais de uma loja do cluster na plataforma %',
      p_canonical_slug, v_canonical_id, v_conflict_platform;
  end if;

  update store_aliases set store_id = v_canonical_id where store_id = any(v_absorbed_ids);

  -- Move offers; offer_history segue automaticamente via ON UPDATE CASCADE (ver comentário
  -- no início do arquivo) — sem isso, mudar a PK de offers com offer_history ainda
  -- apontando pro valor antigo violaria a FK composta.
  update offers set store_id = v_canonical_id where store_id = any(v_absorbed_ids);

  -- crawl_state: store_id é coluna de payload (PK é platform_id+slug), sem risco de colisão.
  update crawl_state set store_id = v_canonical_id where store_id = any(v_absorbed_ids);

  -- store_logo_sources: store_id é parte da PK (store_id, platform_id) — precisa de
  -- upsert-then-delete, não dá pra só fazer UPDATE (o canônico pode já ter fonte pra
  -- mesma plataforma). Mantém a mais recente por last_seen_at.
  insert into store_logo_sources (store_id, platform_id, url, last_seen_at)
  select v_canonical_id, platform_id, url, last_seen_at
  from store_logo_sources
  where store_id = any(v_absorbed_ids)
  on conflict (store_id, platform_id) do update
    set url = excluded.url, last_seen_at = excluded.last_seen_at
    where excluded.last_seen_at > store_logo_sources.last_seen_at;

  delete from store_logo_sources where store_id = any(v_absorbed_ids);

  -- activation_metrics: soma por (day, platform_id) antes de apagar. Obrigatório, não só
  -- higiene — activation_metrics.store_id references stores(id) sem ON DELETE, então
  -- pular isso quebra o DELETE das lojas absorvidas assim que houver alguma ativação real.
  insert into activation_metrics (day, store_id, platform_id, activations)
  select day, v_canonical_id, platform_id, activations
  from activation_metrics
  where store_id = any(v_absorbed_ids)
  on conflict (day, store_id, platform_id) do update
    set activations = activation_metrics.activations + excluded.activations;

  delete from activation_metrics where store_id = any(v_absorbed_ids);

  -- subscriptions (#115, ADR-0063): a Inscrição referencia `stores` SEM `on delete cascade`,
  -- justamente para que esquecer este passo quebre alto em vez de apagar a inscrição em silêncio.
  -- Sem ele, o `delete from stores` abaixo falha e o merge inteiro para.
  --
  -- Mesmo upsert-then-delete de store_logo_sources: (subscriber_id, store_id) é PK, e o canônico
  -- pode já ter inscrição do mesmo assinante. Na colisão sobrevive a MAIS RECENTE — modo e Piso
  -- são regra, não medida, então não se somam nem se mediam.
  --
  -- EMPATE: o comparador é estrito (`>`), então `created_at` igual mantém a inscrição da CANÔNICA.
  -- Empate não tem "mais recente" — a escolha é arbitrária por natureza, e o que se exige dela é
  -- ser determinística e declarada, não justa. Mesmo comparador estrito de store_logo_sources.
  -- Entre duas ABSORVIDAS empatadas, o desempate cai no `store_id desc` do ORDER BY abaixo, que é
  -- ordem de inserção e não significado — igualmente arbitrário, igualmente determinístico.
  --
  -- O `distinct on` não é adorno: um cluster transitivo pode absorver DUAS lojas onde o mesmo
  -- assinante estava inscrito (o `brinox`~`brinoxshop`~`lojaoficialbrinox` do recon é exatamente
  -- isso). Sem ele, o INSERT traria duas linhas para a mesma PK e o Postgres aborta com "ON
  -- CONFLICT DO UPDATE command cannot affect row a second time".
  insert into subscriptions (subscriber_id, store_id, mode, floor_value, floor_reward_type, created_at)
  select distinct on (subscriber_id)
    subscriber_id, v_canonical_id, mode, floor_value, floor_reward_type, created_at
  from subscriptions
  where store_id = any(v_absorbed_ids)
  order by subscriber_id, created_at desc, store_id desc
  on conflict (subscriber_id, store_id) do update
    set mode              = excluded.mode,
        floor_value       = excluded.floor_value,
        floor_reward_type = excluded.floor_reward_type,
        created_at        = excluded.created_at
    where excluded.created_at > subscriptions.created_at;

  delete from subscriptions where store_id = any(v_absorbed_ids);

  -- Redirects: registra os slugs recém-absorvidos e reponta quem já apontava pra eles —
  -- é isso que faz clusters transitivos (A->B, depois B->C) convergirem: A passa a
  -- apontar direto pra C, nunca fica preso num B já deletado.
  insert into store_slug_redirects (from_slug, to_store_id)
  select slug, v_canonical_id from stores where id = any(v_absorbed_ids)
  on conflict (from_slug) do update set to_store_id = excluded.to_store_id;

  update store_slug_redirects set to_store_id = v_canonical_id
    where to_store_id = any(v_absorbed_ids);

  -- Nome e logo do canônico nunca são tocados acima — preservação é por omissão.
  -- Une categorias do cluster sem perder as evidências das lojas absorvidas.
  insert into store_categories (store_id, category_slug, evidence)
  select v_canonical_id, category_slug, jsonb_agg(distinct source.value)
  from store_categories cross join lateral jsonb_array_elements(evidence) source
  where store_id = any(v_absorbed_ids)
  group by category_slug
  on conflict (store_id, category_slug) do update
    set evidence = (select jsonb_agg(distinct item.value)
      from jsonb_array_elements(store_categories.evidence || excluded.evidence) item);
  delete from store_categories where store_id = any(v_absorbed_ids);

  delete from stores where id = any(v_absorbed_ids);

  return query select true, 'merged'::text, v_absorbed_slugs;
end;
$$;

-- CREATE OR REPLACE substitui as propriedades da função, não só o corpo (mesma nota da
-- 20260718000000): dono e grants são reafirmados abaixo.
alter function curation.apply_alias_merge(text, jsonb) owner to farejo_curation_owner;
revoke all on function curation.apply_alias_merge(text, jsonb) from public, anon, authenticated, farejo_web;
grant execute on function curation.apply_alias_merge(text, jsonb) to farejo_curation;
