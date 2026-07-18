-- F3/T9 (#55, ADR-0012/ADR-0013): boost, valor típico e valor anterior nativo.
--
-- `offers` ganha um snapshot do "era X" nativo (méliuz/cuponomia via del.rewardsTag-previous,
-- inter via previousCashback) — persistido, não descartado, porque a precedência de valor
-- anterior (ADR-0013) exige comparar o nativo com o valor atual antes de cair para o
-- intervalo histórico. `previous_reward_type`/`previous_value` só valem apresentação quando
-- coincidem com o `reward_type` vigente da oferta; a checagem de igualdade fica no TS
-- (apps/web/src/lib/history.ts), não aqui.
--
-- Boost e valor típico NÃO viram coluna: são sempre derivados na leitura a partir da
-- reconstrução de intervalos em degraus de `offer_history` (a mesma composição de
-- apps/web/src/lib/history.ts, já usada por `web_read.store_history`). Esta migration só
-- acrescenta `web_read.catalog_history`, a versão em lote de `store_history` — o catálogo
-- pagina até 24 lojas por vez e precisaria de 24 idas ao banco sem ela.

alter table offers
  add column previous_reward_type text,
  add column previous_value numeric(10,2),
  add column previous_raw_text text;

-- Mesma assinatura de 20260718000000_offer_history_value_partial.sql — create or replace
-- basta. search_path precisa ser respecificado (ADR/nota de 20260714033002).
create or replace function pipeline_write_offers(
  p_platform_id text,
  p_run_started_at timestamptz,
  p_offers jsonb,
  p_scope_store_ids bigint[] default null,
  p_outcomes jsonb default null
) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_offer    jsonb;
  v_store_id bigint;
  v_existing offers%rowtype;
  v_outcome  jsonb;
begin
  if p_scope_store_ids is null and exists (
    select 1 from crawl_state where platform_id = p_platform_id
  ) then
    raise exception
      'pipeline_write_offers: p_scope_store_ids não pode ser null para a plataforma % (tem linhas em crawl_state)',
      p_platform_id;
  end if;

  for v_offer in select * from jsonb_array_elements(p_offers)
  loop
    v_store_id := (v_offer ->> 'store_id')::bigint;

    select * into v_existing from offers
      where store_id = v_store_id and platform_id = p_platform_id
      for update;

    if not found then
      -- regra 1: primeiro-visto — nasce a oferta e o primeiro ponto da série no histórico
      insert into offers (
        store_id, platform_id, reward_type, value, value_partial, is_upto,
        raw_text, url, active, last_seen_at, updated_at,
        previous_reward_type, previous_value, previous_raw_text
      ) values (
        v_store_id, p_platform_id, v_offer ->> 'reward_type', (v_offer ->> 'value')::numeric,
        (v_offer ->> 'value_partial')::numeric, (v_offer ->> 'is_upto')::boolean,
        v_offer ->> 'raw_text', v_offer ->> 'url', true, p_run_started_at, now(),
        v_offer ->> 'previous_reward_type', (v_offer ->> 'previous_value')::numeric, v_offer ->> 'previous_raw_text'
      );

      insert into offer_history (store_id, platform_id, reward_type, value, value_partial, is_upto, changed_at)
      values (
        v_store_id, p_platform_id, v_offer ->> 'reward_type', (v_offer ->> 'value')::numeric,
        (v_offer ->> 'value_partial')::numeric, (v_offer ->> 'is_upto')::boolean, p_run_started_at
      );

    elsif v_existing.reward_type is distinct from (v_offer ->> 'reward_type')
       or v_existing.value is distinct from (v_offer ->> 'value')::numeric
       or v_existing.value_partial is distinct from (v_offer ->> 'value_partial')::numeric
       or v_existing.is_upto is distinct from (v_offer ->> 'is_upto')::boolean
       or v_existing.active is distinct from true then
      -- regras 2 e 4: valor/parcial/tipo/upto mudou, e/ou estava inativa e reativou agora
      -- (ADR-0011: mudança em value OU value_partial cria novo evento delta)
      update offers set
        reward_type   = v_offer ->> 'reward_type',
        value         = (v_offer ->> 'value')::numeric,
        value_partial = (v_offer ->> 'value_partial')::numeric,
        is_upto       = (v_offer ->> 'is_upto')::boolean,
        raw_text      = v_offer ->> 'raw_text',
        url           = v_offer ->> 'url',
        active        = true,
        last_seen_at  = p_run_started_at,
        updated_at    = now(),
        previous_reward_type = v_offer ->> 'previous_reward_type',
        previous_value        = (v_offer ->> 'previous_value')::numeric,
        previous_raw_text     = v_offer ->> 'previous_raw_text'
      where store_id = v_store_id and platform_id = p_platform_id;

      insert into offer_history (store_id, platform_id, reward_type, value, value_partial, is_upto, changed_at)
      values (
        v_store_id, p_platform_id, v_offer ->> 'reward_type', (v_offer ->> 'value')::numeric,
        (v_offer ->> 'value_partial')::numeric, (v_offer ->> 'is_upto')::boolean, p_run_started_at
      );

    else
      -- regra 5: re-run idempotente — nada mudou, só bumpa last_seen_at (sem linha de histórico).
      -- previous_* ainda é reescrito: ADR-0013 exige que um "era X" nativo ausente numa leitura
      -- bem-sucedida limpe o snapshot, mesmo sem o valor atual ter mudado.
      update offers set
        value_partial = (v_offer ->> 'value_partial')::numeric,
        raw_text      = v_offer ->> 'raw_text',
        url           = v_offer ->> 'url',
        last_seen_at  = p_run_started_at,
        updated_at    = now(),
        previous_reward_type = v_offer ->> 'previous_reward_type',
        previous_value        = (v_offer ->> 'previous_value')::numeric,
        previous_raw_text     = v_offer ->> 'previous_raw_text'
      where store_id = v_store_id and platform_id = p_platform_id;
    end if;
  end loop;

  -- Sincronização de crawl_state (ADR-0001/ADR-0004): promoção/demoção de tier na MESMA
  -- transação da escrita acima. p_outcomes já vem sem 'soft_block' (filtrado no TS).
  if p_outcomes is not null then
    for v_outcome in select * from jsonb_array_elements(p_outcomes)
    loop
      if (v_outcome ->> 'outcome') = 'offer' then
        insert into crawl_state (platform_id, slug, store_id, tier, last_checked_at, last_outcome)
        values (
          p_platform_id, v_outcome ->> 'slug', (v_outcome ->> 'store_id')::bigint,
          'active', p_run_started_at, 'offer'
        )
        on conflict (platform_id, slug) do update set
          store_id        = excluded.store_id,
          tier             = 'active',
          last_checked_at  = p_run_started_at,
          last_outcome     = 'offer';
      else
        -- no_cashback | not_found: demove pra tail, store_id NUNCA entra no SET —
        -- fica retido do que já existia (ADR-0004 decisão 2). Só o insert (slug novo)
        -- grava null, porque não há store_id nenhum resolvido ainda.
        insert into crawl_state (platform_id, slug, store_id, tier, last_checked_at, last_outcome)
        values (
          p_platform_id, v_outcome ->> 'slug', null,
          'tail', p_run_started_at, v_outcome ->> 'outcome'
        )
        on conflict (platform_id, slug) do update set
          tier             = 'tail',
          last_checked_at  = p_run_started_at,
          last_outcome     = excluded.last_outcome;
      end if;
    end loop;
  end if;

  -- regra 3: desativação por ausência, restrita ao escopo do run — só ofertas ATIVAS
  -- dessa plataforma que este run devia ter tocado e não tocou (last_seen_at ficou pra
  -- trás do início do run). p_scope_store_ids null = escopo é a plataforma inteira
  -- (Fase 1, preservado); array (inclusive vazio) restringe a store_id = any(...).
  -- ADR-0011: desativação grava value = null E value_partial = null nas duas modalidades.
  insert into offer_history (store_id, platform_id, reward_type, value, value_partial, is_upto, changed_at)
  select store_id, platform_id, reward_type, null, null, is_upto, p_run_started_at
  from offers
  where platform_id = p_platform_id
    and active = true
    and last_seen_at < p_run_started_at
    and (p_scope_store_ids is null or store_id = any(p_scope_store_ids));

  update offers
  set active = false, updated_at = now()
  where platform_id = p_platform_id
    and active = true
    and last_seen_at < p_run_started_at
    and (p_scope_store_ids is null or store_id = any(p_scope_store_ids));
end;
$$;

revoke execute on function public.pipeline_write_offers(text, timestamptz, jsonb, bigint[], jsonb)
  from public, anon, authenticated;
grant execute on function public.pipeline_write_offers(text, timestamptz, jsonb, bigint[], jsonb)
  to service_role;

set role farejo_web_read_owner;

-- `previous_reward_type`/`previous_value` entram na allowlist de apresentação (ADR-0028):
-- é o snapshot nativo cru, sem o texto de auditoria (`previous_raw_text` fica só em `public.offers`).
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
  offers.last_seen_at,
  offers.previous_reward_type,
  offers.previous_value::double precision as previous_value
from public.offers
join public.stores on stores.id = offers.store_id
join public.platforms on platforms.id = offers.platform_id
where offers.active = true
  and offers.last_seen_at >= now() - interval '48 hours';

-- Versão em lote de `web_read.store_history` (mesma reconstrução de âncora + janela de 60
-- dias, ADR-0010/ADR-0011): o catálogo pagina até 24 lojas por vez e o boost/valor típico
-- de cards precisa do histórico de todas elas numa única consulta, não 24. A composição em
-- degraus, o corte na borda da janela e a mediana ponderada continuam no TS
-- (apps/web/src/lib/history.ts) — aqui é só leitura ordenada, sem interpolação.
create function web_read.catalog_history(store_slugs text[])
returns table (
  store_slug text,
  platform_id text,
  platform_name text,
  reward_type text,
  value double precision,
  value_partial double precision,
  is_upto boolean,
  changed_at timestamptz
)
language sql
stable
security definer
set search_path = web_read, pg_catalog
as $$
  with target_stores as (
    select id, slug from public.stores where slug = any(store_slugs)
  ),
  window_start as (
    select now() - interval '60 days' as at
  ),
  anchor as (
    select distinct on (target_stores.slug, offer_history.platform_id)
      target_stores.slug as store_slug,
      offer_history.platform_id,
      offer_history.reward_type,
      offer_history.value::double precision as value,
      offer_history.value_partial::double precision as value_partial,
      offer_history.is_upto,
      offer_history.changed_at
    from public.offer_history
    join target_stores on target_stores.id = offer_history.store_id
    cross join window_start
    where offer_history.changed_at < window_start.at
    order by target_stores.slug, offer_history.platform_id, offer_history.changed_at desc
  ),
  within_window as (
    select
      target_stores.slug as store_slug,
      offer_history.platform_id,
      offer_history.reward_type,
      offer_history.value::double precision as value,
      offer_history.value_partial::double precision as value_partial,
      offer_history.is_upto,
      offer_history.changed_at
    from public.offer_history
    join target_stores on target_stores.id = offer_history.store_id
    cross join window_start
    where offer_history.changed_at >= window_start.at
  ),
  combined as (
    select * from anchor
    union all
    select * from within_window
  )
  select combined.store_slug, combined.platform_id, platforms.name as platform_name, combined.reward_type,
    combined.value, combined.value_partial, combined.is_upto, combined.changed_at
  from combined
  join public.platforms on platforms.id = combined.platform_id
  order by combined.store_slug, combined.platform_id, combined.changed_at;
$$;

reset role;

revoke all on all tables in schema web_read from public, anon, authenticated;
grant select on table web_read.catalog_offers to farejo_web;
revoke all on function web_read.catalog_history(text[]) from public, anon, authenticated;
grant execute on function web_read.catalog_history(text[]) to farejo_web;
