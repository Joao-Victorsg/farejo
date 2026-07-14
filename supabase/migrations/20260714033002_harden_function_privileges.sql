-- T17/#34 — funções públicas não devem ser executáveis por anon/authenticated.
--
-- `rls_auto_enable` é criada e mantida pelo Supabase para garantir RLS em novas
-- tabelas. O event trigger que a chama continua necessário; somente removemos a
-- possibilidade de chamadas diretas através dos papéis expostos pela Data API.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;

-- A função de escrita é chamada exclusivamente pelo scraper com service_role.
-- Fixar o search_path evita que objetos de schemas controláveis pelo chamador
-- alterem a resolução dos nomes não qualificados no corpo PL/pgSQL.
alter function public.pipeline_write_offers(text, timestamptz, jsonb, bigint[], jsonb)
  set search_path = pg_catalog, public;

revoke execute on function public.pipeline_write_offers(text, timestamptz, jsonb, bigint[], jsonb)
  from public, anon, authenticated;

grant execute on function public.pipeline_write_offers(text, timestamptz, jsonb, bigint[], jsonb)
  to service_role;
