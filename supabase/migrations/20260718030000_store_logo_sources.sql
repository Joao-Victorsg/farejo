-- F3/T11 (#57, ADR-0038): fontes de logo observadas por (loja, plataforma), persistidas
-- em runs aceitos pelo sanity check, sem baixar/decodificar imagem no caminho do scrape.
--
-- `store_logo_sources` é privada: vive em `public` como `crawl_state`, sem grant a
-- `farejo_web_read_owner`/`farejo_web`/`anon`/`authenticated` — só `service_role` a alcança
-- (o schema `web_read` sequer a referencia). No máximo uma linha por `(store_id,
-- platform_id)` via PK; mudança de URL faz update in-place, sem histórico de URLs.
create table store_logo_sources (
  store_id      bigint not null references stores(id),
  platform_id   text not null references platforms(id),
  url           text not null,
  last_seen_at  timestamptz not null,
  primary key (store_id, platform_id)
);

alter table store_logo_sources enable row level security;

grant select, insert, update, delete on store_logo_sources to service_role;

-- Mesma assinatura de 20260718010000_boost_typical_previous_value.sql — create or replace
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

    -- F3/T11 (#57, ADR-0038): upsert da fonte de logo corrente, na mesma transação da
    -- oferta, independente de qual dos três ramos acima rodou. `logo_url` ausente (chave
    -- faltando ou json null) não apaga uma fonte válida anterior — o passo é só pulado.
    if (v_offer ->> 'logo_url') is not null then
      insert into store_logo_sources (store_id, platform_id, url, last_seen_at)
      values (v_store_id, p_platform_id, v_offer ->> 'logo_url', p_run_started_at)
      on conflict (store_id, platform_id) do update set
        url          = excluded.url,
        last_seen_at = excluded.last_seen_at;
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
  -- Desativação por ausência NUNCA toca store_logo_sources (ADR-0038): a loja ainda existe,
  -- só a oferta desta plataforma ficou inativa, e uma fonte de logo válida não é apagada.
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
