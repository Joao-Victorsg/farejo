# Verificação negativa de privilégios exige superfície mínima e revoga o baseline do Supabase

## Contexto

O gate de publicação (ADR-0041) confirmava o contrato **positivo** do banco: roles, views, funções,
RLS e uma amostra de grants que **devem existir**. A #65 pede o complemento — provar que
`anon`, `authenticated`, `farejo_web` e `farejo_logo_writer` **não têm nada além do contrato**.
Presença e ausência são perguntas diferentes: `has_*_privilege()` responde "a role consegue X?"
(fechada, não enumera), então nenhuma combinação dela detecta um grant que ninguém previu — um
`grant`/`create policy` manual no dashboard, uma mudança de baseline da plataforma, um objeto
criado fora do fluxo.

Enumerar o ACL real (`aclexplode` sobre `pg_class`/`pg_proc`/`pg_namespace`/`pg_attribute`, mais
`pg_auth_members`, `pg_policies` e atributos de `pg_roles`) revelou o que a auditoria positiva
nunca veria: **`anon` e `authenticated` carregam o baseline default do Supabase em `public`** —
`TRUNCATE`/`REFERENCES`/`TRIGGER`/`MAINTAIN` em toda tabela (default ACL do role `postgres`, dono de
todas as tabelas do produto), `UPDATE` em toda sequence, e `USAGE` no schema `public` concedido
direto (o `revoke usage on schema public from public` da 20260717000000 nunca os atingiu, porque
revoga do pseudo-role `PUBLIC`, não de grants diretos). Nenhuma migration do farejô concedeu isso.

Não é explorável hoje: `anon`/`authenticated` são `NOLOGIN` e o farejô nunca usa a Data API (leitura
pública é server-only via `farejo_web` nas views `web_read`), e o PostgREST não expõe
`TRUNCATE`/`REFERENCES`/`TRIGGER`/`MAINTAIN`. Mas "não-explorável" não é "inexistente": `TRUNCATE` é
destrutivo e ficaria armado se algum vetor surgisse.

## Decisão

Postura **estrita**: a superfície negativa é mínima e verificada, não apenas coberta por RLS como
segunda camada.

1. **Hardening** (migration `20260724000000_revoke_anon_authenticated_baseline.sql`): revoga de
   `anon`/`authenticated` todos os privilégios em `public` (tabelas, sequences, `USAGE` do schema) e
   neutraliza o default ACL do role `postgres` para que objetos futuros não reganhem o baseline.
   Validado ao vivo contra o Postgres local: baseline zerado, tabela nova não reganha, e a suíte de
   integração inteira (que usa só `service_role`/`farejo_web`/`farejo_logo_writer`, nunca
   `anon`/`authenticated`) segue verde.

2. **Verificação negativa** (`packages/db-audit/src/verify-privileges.ts`,
   `pnpm --filter @farejo/db-audit verify:privileges`): enumera o ACL real dos grantees auditados nos
   schemas do produto (`public`, `web_read`, `activation`, `curation`) e falha se houver **qualquer**
   par fora de uma allowlist exata — grants de tabela/coluna/função/schema, memberships (escalação
   por herança), atributos de role (`SUPERUSER`/`BYPASSRLS`/`CREATEROLE`/`CREATEDB`/`REPLICATION`,
   `INHERIT` nas roles do farejô, e desvio do flag de login), e policies permissivas. Novo passo no
   `deploy.yml`, logo após `verify:schema`, mesma credencial.

Grantees auditados: os quatro do AC mais `PUBLIC` (um grant a `PUBLIC` atinge anon/authenticated).
As roles operacionais (`farejo_activation`/`farejo_metrics`/`farejo_curation`/`farejo_logo_coverage`)
ficam de fora — não são expostas ao browser, e o lado positivo já as cobre. `INHERIT` só é auditado
nas roles criadas pelo farejô (`noinherit` por contrato); `anon`/`authenticated` carregam o `INHERIT`
default da plataforma, inócuo porque não são membros de nenhuma role (o próprio check de membership
garante que continue assim).

## Consequências

- A promessa da ADR-0042 ("`farejo_logo_writer` nunca vê ofertas") deixa de ser texto e vira
  asserção executável no gate: qualquer SELECT/EXECUTE que essa role ganhe em `offers`/`offer_history`/
  aliases/histórico reprova a publicação.
- O vetor mais perigoso — `create policy ... to anon using (true)` em `offers`, ou `grant select on
  offers to anon` — passa a reprovar o deploy, coisa que os checks positivos nunca veriam. Validado
  injetando seis vetores reais (grant de tabela, de função, de schema, membership, `BYPASSRLS`,
  policy nova) e confirmando que os seis são pegos, cada um na sua categoria.
- O gate depende do hardening: sem a migration `20260724000000`, a verificação falha de propósito
  (tornar o baseline visível era o ponto). Como a migration é aplicada no mesmo deploy, antes da
  verificação, o estado é normalizado antes do gate avaliá-lo.
- Risco residual assumido: se produção tiver um grant que nem o hardening nem a allowlist preveem, o
  primeiro deploy falha no passo de privilégios — depois do hardening (aditivo, seguro) e do
  `verify:schema`, antes do deploy Vercel. Produção segue no artefato anterior; a surpresa é
  auditada, não publicada. É o comportamento desejado de um gate de segurança.
- A verificação cobre só os grantees do AC. Estender às roles operacionais e a `service_role` (ampla
  por design) fica como follow-up — a allowlist para elas seria maior e menos crítica.
- `packages/db-audit` passa a ter dois verificadores (schema, privilégios) sobre o mesmo helper de
  pool (ADR-0055) — reforça que o pacote é a casa da auditoria operacional do banco (ADR-0061), não
  do app.
