-- F3/T8 (#54): offer_history passa a acompanhar value_partial (ADR-0011), permitindo que
-- o histórico do Inter siga o toggle global de correntista em vez de representar sempre a
-- taxa de correntista. Migration aditiva: linhas anteriores ficam com value_partial = null,
-- e esse período permanece explicitamente desconhecido (não é reconstruído).

alter table offer_history add column value_partial numeric(10,2);

-- Mesma assinatura de 20260712150000_crawl_state_sync.sql — create or replace basta.
-- search_path precisa ser respecificado: CREATE OR REPLACE substitui as propriedades da
-- função (ADR/nota de 20260714033002_harden_function_privileges.sql), não só o corpo.
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
        raw_text, url, active, last_seen_at, updated_at
      ) values (
        v_store_id, p_platform_id, v_offer ->> 'reward_type', (v_offer ->> 'value')::numeric,
        (v_offer ->> 'value_partial')::numeric, (v_offer ->> 'is_upto')::boolean,
        v_offer ->> 'raw_text', v_offer ->> 'url', true, p_run_started_at, now()
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
        updated_at    = now()
      where store_id = v_store_id and platform_id = p_platform_id;

      insert into offer_history (store_id, platform_id, reward_type, value, value_partial, is_upto, changed_at)
      values (
        v_store_id, p_platform_id, v_offer ->> 'reward_type', (v_offer ->> 'value')::numeric,
        (v_offer ->> 'value_partial')::numeric, (v_offer ->> 'is_upto')::boolean, p_run_started_at
      );

    else
      -- regra 5: re-run idempotente — nada mudou, só bumpa last_seen_at (sem linha de histórico)
      update offers set
        value_partial = (v_offer ->> 'value_partial')::numeric,
        raw_text      = v_offer ->> 'raw_text',
        url           = v_offer ->> 'url',
        last_seen_at  = p_run_started_at,
        updated_at    = now()
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

-- Leitura pública do histórico (60 dias + âncora anterior à janela, ADR-0010/ADR-0011).
grant select on table public.offer_history to farejo_web_read_owner;

create policy web_read_owner_select_offer_history on public.offer_history
  for select to farejo_web_read_owner using (true);

set role farejo_web_read_owner;

-- Retorna, por plataforma, o último evento anterior aos 60 dias (âncora, quando existe) e
-- todos os eventos dentro da janela, em ordem cronológica. A composição em degraus, o
-- corte na borda da janela e a decisão "histórico insuficiente" ficam no TS
-- (apps/web/src/lib/history.ts) — aqui é só leitura ordenada, sem interpolação nem
-- fabricação de pontos.
create function web_read.store_history(requested_slug text)
returns table (
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
  with target_store as (
    select id from public.stores where slug = requested_slug
  ),
  window_start as (
    select now() - interval '60 days' as at
  ),
  anchor as (
    select distinct on (offer_history.platform_id)
      offer_history.platform_id,
      offer_history.reward_type,
      offer_history.value::double precision as value,
      offer_history.value_partial::double precision as value_partial,
      offer_history.is_upto,
      offer_history.changed_at
    from public.offer_history, target_store, window_start
    where offer_history.store_id = target_store.id
      and offer_history.changed_at < window_start.at
    order by offer_history.platform_id, offer_history.changed_at desc
  ),
  within_window as (
    select
      offer_history.platform_id,
      offer_history.reward_type,
      offer_history.value::double precision as value,
      offer_history.value_partial::double precision as value_partial,
      offer_history.is_upto,
      offer_history.changed_at
    from public.offer_history, target_store, window_start
    where offer_history.store_id = target_store.id
      and offer_history.changed_at >= window_start.at
  ),
  combined as (
    select * from anchor
    union all
    select * from within_window
  )
  select combined.platform_id, platforms.name as platform_name, combined.reward_type,
    combined.value, combined.value_partial, combined.is_upto, combined.changed_at
  from combined
  join public.platforms on platforms.id = combined.platform_id
  order by combined.platform_id, combined.changed_at;
$$;

reset role;

revoke all on function web_read.store_history(text) from public, anon, authenticated;
grant execute on function web_read.store_history(text) to farejo_web;
