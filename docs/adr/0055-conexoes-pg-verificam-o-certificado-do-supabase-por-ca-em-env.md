# Conexões `pg` verificam o certificado do Supabase por CA em variável de ambiente

## Contexto

O scraper escreve em produção desde a Fase 2, mas sempre por `supabase-js` — HTTPS/PostgREST contra
`https://<ref>.supabase.co`, cujo certificado vem de CA pública e por isso nunca exigiu nenhuma
configuração de TLS. A Fase 3 introduziu um segundo caminho: seis `Pool` do `pg` falando o protocolo
nativo do Postgres, com roles dedicadas (`farejo_logo_writer`, `farejo_logo_coverage`,
`farejo_curation`, `farejo_web`, `farejo_activation`, `farejo_metrics`) e a conexão privilegiada de
deploy. Todos foram desenvolvidos e testados apenas contra o stack local (`supabase start`), que
fala sem TLS.

A primeira tentativa real (ingestão de logos, 21/07/2026) falhou na primeira query com
`SELF_SIGNED_CERT_IN_CHAIN`: o certificado do Postgres e do pooler do Supabase não encadeia até uma
raiz do trust store padrão do Node. O CA do projeto só é obtido pelo dashboard; não há URL pública
estável para baixá-lo.

Duas armadilhas cercam a correção:

- `sslmode=require` **não** significa "cifra sem verificar" nesta stack. O `pg-connection-string`
  vigente trata `prefer`/`require`/`verify-ca` como alias de `verify-full`, e avisa que a semântica
  libpq (mais fraca) só voltará numa major futura.
- `pg` monta a configuração como `Object.assign({}, config, parse(connectionString))` — o parse da
  connection string **vence** o objeto explícito. E o `pg-connection-string` cria `config.ssl = {}`
  sempre que enxerga `sslmode` na URL. Um `?sslmode=` sobrevivente descarta o CA em silêncio e
  devolve exatamente o mesmo erro, sem nada apontando para a causa.

## Decisão

Toda conexão `pg` do projeto verifica a identidade do servidor: `ssl: { ca, rejectUnauthorized: true }`.

O CA chega pela variável de ambiente `FAREJO_SUPABASE_CA_CERT`, contendo o **PEM inteiro** — não um
caminho de arquivo. Motivo: o mesmo valor precisa valer em GitHub Actions e em função serverless da
Vercel. Um arquivo exigiria caminho relativo estável no runner e `outputFileTracingIncludes` para
sobreviver ao bundle do Next; a variável não depende de nenhum dos dois e é idêntica nos dois
ambientes.

O CA é **secret de repositório**, não de Environment. Ele não é sensível — é o certificado público
do Supabase, e o segredo continua sendo a senha da role. Uma cópia única evita o problema que as
três cópias do segredo de invalidação já demonstram: valores que precisam ser idênticos e são
mantidos separadamente divergem em silêncio. Ainda assim ele viaja como secret, e não como arquivo
versionado, para que a rotação seja um lugar só e o vencimento não fique escondido no repositório.

Nenhuma connection string pode conter `sslmode`. A construção do pool **recusa explicitamente** uma
URL que o contenha, em vez de deixar o CA ser descartado sem sinal.

Host remoto sem CA configurado também é recusado, em vez de degradar para uma conexão não
verificada. Só `localhost`/`127.0.0.1`/`::1` dispensam TLS, porque o stack local não o oferece e
exigi-lo quebraria todo o teste de integração.

A fronteira vive em um helper por app — `apps/scraper/src/postgresPool.ts` e
`apps/web/src/lib/postgres-pool.ts` — e não em `packages/shared`: a ADR-0002 mantém `shared` como
domínio puro que nunca lê `process.env`, e configuração de I/O é I/O. O helper do web
deliberadamente não importa `server-only`, porque `verify-production-schema.mts` roda fora do Next;
quem guarda essa fronteira são os consumidores (`catalog.ts`, `activation.ts`), que já a declaram.

> **Nota (23/07/2026, ADR-0061):** passaram a ser **três** helpers — a auditoria de banco ganhou o
> seu em `packages/db-audit/src/postgres-pool.ts` ao sair de `apps/web`. Mudança nesta ADR precisa
> chegar nas três cópias. O motivo de o helper do web não importar `server-only` também mudou: o
> script que rodava fora do Next saiu dali, e quem sustenta a restrição hoje é
> `apps/web/test/postgres-pool.test.ts`, que roda sob vitest. A decisão em si segue valendo.

`supabase db push` não usa esta variável: a CLI traz o próprio trust store.

## Consequências

- A senha da role deixa de trafegar por um canal cuja ponta não é verificada, entre o runner
  (Azure) e o Postgres (AWS `sa-east-1`).
- `FAREJO_SUPABASE_CA_CERT` passa a ser secret obrigatório do repositório — alcança todos os
  workflows — e, separadamente, variável de ambiente do projeto na Vercel, que não recebe secrets do
  GitHub. O guard do `deploy.yml` a exige explicitamente.
- Verificar o certificado no cliente é independente de "Enforce SSL on incoming connections" no
  Supabase: aquela opção faz o servidor recusar conexões sem TLS, esta decisão faz o cliente recusar
  um servidor que não prove sua identidade. São complementares, e nenhuma substitui a outra.
- Esquecer o secret falha cedo e com mensagem própria, nunca com uma conexão em texto claro.
- O CA tem validade. Quando expirar, todas as conexões `pg` param de uma vez — é a contrapartida
  aceita em troca de verificar a identidade do servidor, e o sintoma é imediato e inequívoco.
- Rotação do CA pelo Supabase exige atualizar o secret em dois Environments e na Vercel.
