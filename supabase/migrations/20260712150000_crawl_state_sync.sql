-- Sincronização de crawl_state na mesma transação da escrita de ofertas (T4/#16;
-- ADR-0001 "atualização Fase 2" + ADR-0004 decisão 2). pipeline_write_offers ganha
-- p_outcomes jsonb (nullable, default null): array de {slug, outcome, store_id}, um
-- item por SlugOutcome que NÃO é 'soft_block' (o chamador TS já filtra soft_block antes
-- de montar o array — "soft_block nunca atualiza crawl_state" fica garantido por
-- ausência, não por um branch condicional aqui).
--
-- outcome='offer'  → tier='active', store_id = o resolvido pelo find-or-create (TS).
-- outcome='no_cashback'|'not_found' → tier='tail', store_id NUNCA tocado no update
--   (fica retido do que já existia) — só o insert (linha nova) grava null.
--
-- Mesmo drop-and-recreate de 20260712120000: adicionar parâmetro muda a identidade da
-- função para o Postgres.
drop function if exists pipeline_write_offers(text, timestamptz, jsonb, bigint[]);

create or replace function pipeline_write_offers(
  p_platform_id text,
  p_run_started_at timestamptz,
  p_offers jsonb,
  p_scope_store_ids bigint[] default null,
  p_outcomes jsonb default null
) returns void
language plpgsql
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

grant execute on function pipeline_write_offers(text, timestamptz, jsonb, bigint[], jsonb) to service_role;
