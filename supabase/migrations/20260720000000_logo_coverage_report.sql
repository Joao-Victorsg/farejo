-- F3/T16 (#62, ADR-0054): medição automatizada da meta de 95% de logos finais (ADR-0043).
--
-- farejo_logo_writer (ADR-0042) nunca vê ofertas -- essa role continua sem qualquer grant
-- novo aqui. Medir a meta exige saber quais lojas são "elegíveis" (>= 1 oferta pública
-- ativa), o que só existe hoje em `public.offers`. Em vez de abrir essa tabela para a
-- Action de ingestão, este agregado fica atrás de uma role própria, somente leitura, que
-- nunca enxerga uma linha de oferta -- só duas contagens. Isso não é informação nova: a
-- mesma proporção (quantas lojas do catálogo mostram logo real vs. avatar de fallback) já é
-- observável navegando o site público.
--
-- `web_read.logo_coverage` é derivada de `web_read.catalog_stores` (20260717000000) em vez
-- de reimplementar o filtro de elegibilidade: herda automaticamente a mesma janela de
-- frescor usada pelo catálogo público, sem duplicar a definição em dois lugares.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'farejo_logo_coverage') then
    create role farejo_logo_coverage login noinherit nosuperuser nocreatedb nocreaterole noreplication;
  end if;
end;
$$;

grant farejo_logo_coverage to postgres;

-- Job de diagnóstico de baixa frequência, não caminho quente de usuário.
alter role farejo_logo_coverage set statement_timeout = '10s';
alter role farejo_logo_coverage set search_path = web_read, pg_catalog;

grant usage on schema web_read to farejo_logo_coverage;

set role farejo_web_read_owner;

create view web_read.logo_coverage
with (security_barrier = true, security_invoker = false)
as
select
  count(*)::integer as eligible_stores,
  count(*) filter (where stores.logo_hash is not null)::integer as stores_with_logo
from web_read.catalog_stores
join public.stores on stores.slug = catalog_stores.slug;

reset role;

grant select on table web_read.logo_coverage to farejo_logo_coverage;
