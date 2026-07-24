# Auditoria de banco vive na raiz do monorepo, não dentro do app web

## Contexto

O verificador de schema de produção (ADR-0041) nasceu em `apps/web/test/verify-production-schema.mts`
e era executado por `pnpm --filter @farejo/web verify:schema`. O endereço foi escolhido por
conveniência: `pg`, o helper de pool e a credencial de deploy já estavam ali.

Conveniência virou violação de camada. O arquivo verificava `farejo_curation`, `farejo_logo_writer`
e `farejo_logo_coverage` — roles que o app web nunca usa. Elas pertencem ao `curation-apply.yml` e
ao `logos.yml`. Um teste do app web afirmando o contrato de execução da role de curadoria não tem
como se justificar pelo conteúdo; só pela credencial que estava por perto.

O contrato auditado, por sua vez, **já vive na raiz**: `supabase/migrations/` está no mesmo nível
de `apps/` e `packages/`, e é lá que os ~30 `revoke` declaram o modelo de segurança. Este repo não
é o repo de uma aplicação — é o monorepo do produto, e o schema é cidadão de primeira classe dele.

A pergunta que motivou a revisão foi se essa verificação deveria estar no repositório, dado que
poderia ser considerada configuração de infraestrutura já provisionada. Duas coisas decidiram:
o contrato já é código versionado aqui, e no Supabase o dono do projeto não consegue revogar o
próprio acesso de escrita ao dashboard — não existe a configuração que tornaria "as roles já estão
certas" uma premissa garantida. Detecção não é a control preferida; é a única disponível.

## Decisão

A auditoria de banco passa a ser **`packages/db-audit`**, no mesmo nível de `apps/` e `packages/` —
não dentro de `apps/web`, não em `packages/shared` (a ADR-0002 o mantém como domínio puro que nunca
lê `process.env`).

Ela é **auditoria operacional do banco**, da mesma natureza de `logos.yml` e `scrape.yml`, que
também falam com o Postgres com credencial própria e não são "testes do app". O passo do
`deploy.yml` passa a ser consumidor da auditoria, não seu dono: `pnpm --filter @farejo/db-audit
verify:schema`. Nada mais muda no fluxo de publicação — mesma ordem, mesma credencial, mesmo
relatório.

O pacote carrega a **terceira cópia** do helper de pool da ADR-0055, com teste próprio. Consolidar
as três num `@farejo/postgres` exigiria mexer no caminho de runtime do site (bundling da função
serverless, a condição `react-server` do pacote `server-only`), risco desproporcional para uma
mudança de endereço. Fica como follow-up, registrado nas três cópias e na ADR-0055.

## Consequências

- O contrato de segurança do banco passa a ter um dono nomeado, no nível do que ele descreve.
  Quem procura "onde se verifica o ACL de produção" não precisa mais adivinhar que está sob o app
  web.
- `apps/web` deixa de declarar `verify:schema` e de conter afirmações sobre roles que não usa.
- O pacote é o lugar natural da verificação **negativa** ainda pendente (privilégios em excesso de
  `anon`, `authenticated`, `farejo_web` e `farejo_logo_writer` — AC aberto da #65), que exige
  enumerar ACL via `aclexplode` em vez de perguntar por `has_*_privilege`. Colocá-la em
  `apps/web/test/` teria agravado a violação que esta ADR corrige.
- Três cópias do helper de TLS é dívida real: uma mudança na ADR-0055 que chegue a duas e esqueça a
  terceira degrada silenciosamente a verificação de certificado de quem ficou para trás. Mitigado
  por comentário cruzado nas três e por teste em cada uma, não resolvido.
- O move foi validado contra o Postgres local antes do merge: verificador verde, grant real
  revogado → falha apontando `farejo_web→web_read.store_redirects(SELECT)` com exit 1, grant
  restaurado → verde de novo. `pnpm install --frozen-lockfile` confirmado, porque o pacote novo
  altera o lockfile e o CI o exige íntegro.
