-- F3/T12 (#58, ADR-0006/ADR-0035): mecanismo transacional de aplicação do manifesto de
-- aliases. `curation.apply_alias_merge` funde loja(s) absorvida(s) numa loja canônica
-- explícita, movendo aliases, ofertas, histórico, crawl_state, fontes de logo e métricas
-- de ativação. Uma chamada = uma transação: `raise exception` desfaz tudo desde o início
-- da chamada, sem precisar de begin/commit explícito — é assim que "a decisão falha
-- fechada, sem alteração parcial" é garantido quando o cluster tem duas ofertas da mesma
-- plataforma. Role dedicada de manutenção (ADR-0035): nunca service_role, nunca farejo_web.

-- offer_history referencia offers(store_id, platform_id); por padrão (NO ACTION) o Postgres
-- proíbe mudar essa chave em offers enquanto uma linha de offer_history ainda aponta pro
-- valor antigo — exatamente o que o merge precisa fazer ao mover uma oferta absorvida pro
-- store_id canônico. ON UPDATE CASCADE resolve isso propagando a mudança de store_id
-- automaticamente; nenhum outro caminho de código muda store_id/platform_id de uma offer
-- já existente (pipeline_write_offers só atualiza value/reward_type/etc.), então o cascade
-- nunca dispara fora de um merge.
alter table offer_history
  drop constraint offer_history_store_id_platform_id_fkey,
  add constraint offer_history_store_id_platform_id_fkey
    foreign key (store_id, platform_id) references offers(store_id, platform_id) on update cascade;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'farejo_curation_owner') then
    create role farejo_curation_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'farejo_curation') then
    create role farejo_curation login noinherit nosuperuser nocreatedb nocreaterole noreplication;
  end if;
end;
$$;

grant farejo_curation_owner, farejo_curation to postgres;

-- Job de manutenção de baixa frequência, não caminho quente de usuário (ao contrário de
-- farejo_activation, sem meta de p95): timeout mais folgado para clusters grandes.
alter role farejo_curation set statement_timeout = '10s';
alter role farejo_curation set lock_timeout = '5s';
alter role farejo_curation set search_path = curation, pg_catalog;

create schema if not exists curation authorization farejo_curation_owner;
revoke all on schema curation from public, anon, authenticated, farejo_web;
grant usage on schema curation to farejo_curation;
grant usage, create on schema curation to farejo_curation_owner;
alter default privileges for role farejo_curation_owner in schema curation revoke execute on functions from public;

grant usage on schema public to farejo_curation_owner;

-- Redirect permanente: slug absorvido -> loja canônica corrente. Privada (como
-- crawl_state/store_logo_sources): só service_role e a role de curadoria a alcançam
-- diretamente; o frontend lê via web_read.store_redirects.
create table store_slug_redirects (
  from_slug    text primary key,
  to_store_id  bigint not null references stores(id),
  created_at   timestamptz not null default now()
);

alter table store_slug_redirects enable row level security;

grant select, insert, update, delete on store_slug_redirects to service_role;

-- Grants + policies para farejo_curation_owner: a role de login (farejo_curation) nunca
-- toca essas tabelas diretamente, só via a função security definer abaixo.
create policy curation_owner_select_stores on public.stores
  for select to farejo_curation_owner using (true);
create policy curation_owner_update_stores on public.stores
  for update to farejo_curation_owner using (true) with check (true);
create policy curation_owner_delete_stores on public.stores
  for delete to farejo_curation_owner using (true);
grant select, update, delete on public.stores to farejo_curation_owner;

create policy curation_owner_all_store_aliases on public.store_aliases
  for all to farejo_curation_owner using (true) with check (true);
grant select, insert, update on public.store_aliases to farejo_curation_owner;

create policy curation_owner_all_offers on public.offers
  for all to farejo_curation_owner using (true) with check (true);
grant select, update on public.offers to farejo_curation_owner;

create policy curation_owner_all_offer_history on public.offer_history
  for all to farejo_curation_owner using (true) with check (true);
grant select, update on public.offer_history to farejo_curation_owner;

create policy curation_owner_all_crawl_state on public.crawl_state
  for all to farejo_curation_owner using (true) with check (true);
grant select, update on public.crawl_state to farejo_curation_owner;

create policy curation_owner_all_store_logo_sources on public.store_logo_sources
  for all to farejo_curation_owner using (true) with check (true);
grant select, insert, update, delete on public.store_logo_sources to farejo_curation_owner;

create policy curation_owner_all_activation_metrics on public.activation_metrics
  for all to farejo_curation_owner using (true) with check (true);
grant select, insert, update, delete on public.activation_metrics to farejo_curation_owner;

create policy curation_owner_all_store_slug_redirects on public.store_slug_redirects
  for all to farejo_curation_owner using (true) with check (true);
grant select, insert, update on public.store_slug_redirects to farejo_curation_owner;

create function curation.apply_alias_merge(
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

alter function curation.apply_alias_merge(text, jsonb) owner to farejo_curation_owner;
revoke all on function curation.apply_alias_merge(text, jsonb) from public, anon, authenticated, farejo_web;
grant execute on function curation.apply_alias_merge(text, jsonb) to farejo_curation;

-- Exposição pública mínima do redirect: só (from_slug, to_slug), mesmo padrão de
-- store_details em 20260717000200_web_read_store_detail.sql. RLS está ligado em
-- store_slug_redirects e farejo_web_read_owner não é dona da tabela, então precisa de
-- policy própria (mesmo padrão de web_read_owner_select_store_aliases) além do GRANT.
grant select on table public.store_slug_redirects to farejo_web_read_owner;
create policy web_read_owner_select_store_slug_redirects on public.store_slug_redirects
  for select to farejo_web_read_owner using (true);

set role farejo_web_read_owner;

create view web_read.store_redirects
with (security_barrier = true, security_invoker = false)
as
select store_slug_redirects.from_slug, stores.slug as to_slug
from public.store_slug_redirects
join public.stores on stores.id = store_slug_redirects.to_store_id;

reset role;

revoke all on table web_read.store_redirects from public, anon, authenticated;
grant select on table web_read.store_redirects to farejo_web;
