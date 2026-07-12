-- Escrita atômica do pipeline por plataforma (T8/#9; docs/farejo-system-design.md §3
-- "offer_history é delta-based" + §5.1). Uma função plpgsql = uma transação implícita:
-- se qualquer passo falhar, nada desse run fica gravado pela metade.
--
-- p_offers: array jsonb de {store_id, reward_type, value, value_partial, is_upto, raw_text, url}
-- já resolvidos pelo pipeline (find-or-create + parseReward já rodaram em TS) — esta função só
-- escreve; normalização/interpretação de valor não vivem aqui.
create or replace function pipeline_write_offers(
  p_platform_id text,
  p_run_started_at timestamptz,
  p_offers jsonb
) returns void
language plpgsql
as $$
declare
  v_offer    jsonb;
  v_store_id bigint;
  v_existing offers%rowtype;
begin
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
  -- trás do início do run). Fase 1: escopo é sempre "full", cobre a plataforma inteira.
  insert into offer_history (store_id, platform_id, reward_type, value, is_upto, changed_at)
  select store_id, platform_id, reward_type, null, is_upto, p_run_started_at
  from offers
  where platform_id = p_platform_id
    and active = true
    and last_seen_at < p_run_started_at;

  update offers
  set active = false, updated_at = now()
  where platform_id = p_platform_id
    and active = true
    and last_seen_at < p_run_started_at;
end;
$$;

-- Mesma política de exposição explícita das tabelas (auto_expose_new_tables = false).
grant execute on function pipeline_write_offers(text, timestamptz, jsonb) to service_role;
