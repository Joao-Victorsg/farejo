-- F4/#115 (ADR-0063): a Inscrição atravessa o merge de alias.
--
-- `curation.apply_alias_merge` termina em `delete from stores`, e trata uma a uma todas as tabelas
-- que referenciam a loja. `subscriptions` (#113) entrou depois e ficou de fora — o comentário da
-- própria 20260718040000 já avisava que pular esse tratamento "quebra o DELETE das lojas absorvidas
-- assim que houver alguma ativação real". Aqui o efeito seria pior que perder um Aviso: a violação
-- de FK aborta a decisão inteira, travando o `curation-apply.yml` no primeiro merge que encostar
-- numa loja assinada.
--
-- A role de LOGIN (`farejo_curation`) continua sem tocar a tabela: quem escreve é a dona da função
-- security definer, mesmo padrão das demais.
create policy curation_owner_all_subscriptions on public.subscriptions
  for all to farejo_curation_owner using (true) with check (true);
grant select, insert, update, delete on public.subscriptions to farejo_curation_owner;

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
  delete from stores where id = any(v_absorbed_ids);

  return query select true, 'merged'::text, v_absorbed_slugs;
end;
$$;

-- CREATE OR REPLACE substitui as propriedades da função, não só o corpo (mesma nota da
-- 20260718000000): dono e grants são reafirmados abaixo.
alter function curation.apply_alias_merge(text, jsonb) owner to farejo_curation_owner;
revoke all on function curation.apply_alias_merge(text, jsonb) from public, anon, authenticated, farejo_web;
grant execute on function curation.apply_alias_merge(text, jsonb) to farejo_curation;
