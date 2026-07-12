-- Schema da Fase 2 (T3/#15; ADR-0004 "Escopo de run explícito", ADR-0005 decisão 2
-- "platforms.throttle_multiplier"): scrape_runs.scope, crawl_state, platforms.throttle_multiplier,
-- e pipeline_write_offers ganhando p_scope_store_ids.

-- Decisão 1 do ADR-0004: coluna nova, não reaproveita crawl_state.tier. Backfill seguro —
-- toda linha existente é de inter/mycashback, sempre 'full'.
alter table scrape_runs add column scope text not null default 'full'
  check (scope in ('full', 'bootstrap', 'active', 'tail'));

-- Decisão 2 do ADR-0004: ponte entre coleta tiered e desativação restrita por escopo.
-- store_id nullable e retido em todos os desfechos posteriores a 'offer' (nenhum caminho
-- de código o limpa) — é o que permite, num no_cashback seguinte, saber qual store_id
-- considerar para desativação sem precisar de um RawOffer.
create table crawl_state (
  platform_id      text references platforms(id),
  slug             text not null,
  store_id         bigint references stores(id),
  tier             text not null default 'tail' check (tier in ('active', 'tail')),
  last_checked_at  timestamptz,
  last_outcome     text check (last_outcome in ('offer', 'no_cashback', 'not_found', 'soft_block')),
  primary key (platform_id, slug)
);

-- Suporta a query do agendador ("os N slugs mais vencidos de um tier"): filtra por
-- (platform_id, tier), ordena por last_checked_at com NULLS FIRST (slug nunca visitado
-- vence antes de qualquer slug já checado).
create index idx_crawl_state_scheduler on crawl_state (platform_id, tier, last_checked_at);

-- Decisão 2 do ADR-0005: escada rígida de propósito — subir o teto exige migration
-- consciente, não um valor mágico solto em código.
alter table platforms add column throttle_multiplier smallint not null default 1
  check (throttle_multiplier in (1, 2, 4));

alter table crawl_state enable row level security;

grant select, insert, update, delete on crawl_state to service_role;

-- pipeline_write_offers ganha p_scope_store_ids bigint[] (nullable, default null — chamadores
-- existentes de plataformas full-scope sem linhas em crawl_state continuam funcionando sem
-- passar o parâmetro). Guarda (ADR-0004): null só é aceitável quando a plataforma não usa
-- crawl_state; array vazio restringe a desativação a nenhuma loja (nunca coalescido para null).
--
-- CREATE OR REPLACE não basta aqui: adicionar um parâmetro muda a identidade da função
-- (nome + tipos dos parâmetros de entrada) para o Postgres, então sem o drop explícito da
-- assinatura de 3 parâmetros ficamos com dois overloads coexistindo — e o PostgREST recusa
-- a chamar por nome de parâmetro por não saber escolher entre eles.
drop function if exists pipeline_write_offers(text, timestamptz, jsonb);

create or replace function pipeline_write_offers(
  p_platform_id text,
  p_run_started_at timestamptz,
  p_offers jsonb,
  p_scope_store_ids bigint[] default null
) returns void
language plpgsql
as $$
declare
  v_offer    jsonb;
  v_store_id bigint;
  v_existing offers%rowtype;
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

      insert into offer_history (store_id, platform_id, reward_type, value, is_upto, changed_at)
      values (
        v_store_id, p_platform_id, v_offer ->> 'reward_type', (v_offer ->> 'value')::numeric,
        (v_offer ->> 'is_upto')::boolean, p_run_started_at
      );

    elsif v_existing.reward_type is distinct from (v_offer ->> 'reward_type')
       or v_existing.value is distinct from (v_offer ->> 'value')::numeric
       or v_existing.is_upto is distinct from (v_offer ->> 'is_upto')::boolean
       or v_existing.active is distinct from true then
      -- regras 2 e 4: valor/tipo/upto mudou, e/ou estava inativa e reativou agora
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

      insert into offer_history (store_id, platform_id, reward_type, value, is_upto, changed_at)
      values (
        v_store_id, p_platform_id, v_offer ->> 'reward_type', (v_offer ->> 'value')::numeric,
        (v_offer ->> 'is_upto')::boolean, p_run_started_at
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

  -- regra 3: desativação por ausência, restrita ao escopo do run — só ofertas ATIVAS
  -- dessa plataforma que este run devia ter tocado e não tocou (last_seen_at ficou pra
  -- trás do início do run). p_scope_store_ids null = escopo é a plataforma inteira
  -- (Fase 1, preservado); array (inclusive vazio) restringe a store_id = any(...).
  insert into offer_history (store_id, platform_id, reward_type, value, is_upto, changed_at)
  select store_id, platform_id, reward_type, null, is_upto, p_run_started_at
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

grant execute on function pipeline_write_offers(text, timestamptz, jsonb, bigint[]) to service_role;
