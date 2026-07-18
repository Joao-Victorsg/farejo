-- F3/T14 (#60, ADR-0038/ADR-0042): fronteira de Supabase Storage para logos finais.
-- O bucket `store-logos` é criado por upsert idempotente em `storage.buckets` — não por
-- passo manual no dashboard — e roda antes de qualquer ingestão porque toda migration
-- pendente é aplicada no boot do stack (local via `supabase start`, produção via ADR-0041).
--
-- Só existe UMA policy aqui: leitura pública por bucket_id. RLS em `storage.objects` nega
-- tudo por padrão sem policy correspondente (confirmado no stack local: `anon` e
-- `authenticated` já têm INSERT/UPDATE/DELETE concedidos na tabela pelo seed do Supabase,
-- mas RLS bloqueia porque nenhuma policy libera esses comandos) — então a ausência
-- deliberada de policy de INSERT/UPDATE/DELETE é o que impede upload, overwrite, move e
-- delete de `anon`, `authenticated` e de qualquer visitante sem credencial. `farejo_web`
-- nunca teve GRANT nenhum em `storage.objects` (só lê o catálogo via `web_read`), então
-- fica de fora mesmo antes de qualquer policy.
--
-- Quem publica os arquivos finais é a chave S3 do Supabase (ADR-0042): ela autentica
-- direto no serviço de Storage, não como `anon`/`authenticated`/`service_role` via RLS, e
-- por isso não aparece aqui como policy nem como role Postgres — a fronteira dela é
-- operacional (secret do GitHub Environment do workflow de logos), não de banco.
--
-- Nota (18/07/2026): a documentação vigente do Supabase (guides/storage/s3/authentication)
-- confirma que a chave de acesso S3 "provide[s] full access to all S3 operations across
-- all buckets and bypass[es] RLS policies" — sem escopo por bucket disponível na
-- plataforma atual. A limitação já registrada na ADR-0042 permanece válida nesta data;
-- nada a corrigir na decisão.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('store-logos', 'store-logos', true, 2097152, array['image/webp'])
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'store_logos_public_read'
  ) then
    create policy store_logos_public_read on storage.objects
      for select
      using (bucket_id = 'store-logos');
  end if;
end;
$$;

-- `farejo_logo_writer` (ADR-0042): role de banco separada da chave S3, usada pela Action
-- de logos só para ler o estado de `store_logo_sources` e apontar o resultado final em
-- `stores`. Nunca `service_role`, nunca as tabelas de ofertas/aliases/histórico.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'farejo_logo_writer') then
    create role farejo_logo_writer login noinherit nosuperuser nocreatedb nocreaterole noreplication;
  end if;
end;
$$;

grant farejo_logo_writer to postgres;

-- Job de manutenção de baixa frequência (roda depois do scrape, não caminho quente de
-- usuário): timeout folgado o bastante para varrer fontes pendentes de várias lojas.
alter role farejo_logo_writer set statement_timeout = '30s';
alter role farejo_logo_writer set lock_timeout = '5s';
alter role farejo_logo_writer set search_path = public, pg_catalog;

-- `PUBLIC` não tem mais USAGE em `public` desde 20260717000000_web_read_catalog.sql;
-- toda role nova precisa do GRANT explícito para sequer resolver objetos do schema.
grant usage on schema public to farejo_logo_writer;

grant select, update on public.store_logo_sources to farejo_logo_writer;
create policy logo_writer_select_store_logo_sources on public.store_logo_sources
  for select to farejo_logo_writer using (true);
create policy logo_writer_update_store_logo_sources on public.store_logo_sources
  for update to farejo_logo_writer using (true) with check (true);

-- `stores` não é sensível (é catálogo público, já exposto via `web_read`) — SELECT de
-- linha inteira é seguro. A escrita, porém, fica restrita por coluna: só o ponteiro final
-- do logo, nunca slug/name/created_at.
grant select on public.stores to farejo_logo_writer;
grant update (logo_url, logo_hash) on public.stores to farejo_logo_writer;
create policy logo_writer_select_stores on public.stores
  for select to farejo_logo_writer using (true);
create policy logo_writer_update_stores on public.stores
  for update to farejo_logo_writer using (true) with check (true);
