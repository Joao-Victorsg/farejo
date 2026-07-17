# Fronteira dos pacotes: `shared` é domínio puro; portal só existe no adapter

`packages/shared` contém **domínio puro, sem I/O**: `RawOffer`, `RunScope`, `ScrapeResult`, a union `Reward`, `parseReward`, a chave canônica de normalização, os **tipos** das tabelas e uma **factory de cliente Supabase que recebe url/key por parâmetro**. Decidimos que `shared` **nunca sabe que "inter" ou "mycashback" existem** — `RawOffer` é a **camada anticorrupção**: cada adapter traduz o shape próprio do seu portal para `RawOffer`, e de lá para dentro o portal deixa de existir. Zod em `shared` valida só o **domínio** (`RawOffer`, `Reward`, `ScrapeResult`); os schemas zod de **shape de portal** (ex.: `InterStore`) moram no adapter, em `apps/scraper`.

## Consequências

- **"Sem I/O" inclui configuração de I/O.** `shared` não lê `process.env`. Exporta os tipos das tabelas (gerados por `supabase gen types typescript`, regenerados no workflow de migrations) e uma factory `createClient(url, key)`. Cada app instancia o seu: o **scraper** com `service_role`; o **web** (Fase 3) com credencial e política próprias (`anon`/RLS). A credencial nunca cruza a fronteira do pacote.
- **`parseReward` e `normalize` ficam em `shared` desde a Fase 1**, mesmo só o scraper os usando — a Fase 3 (web) precisa de `Reward` e da chave canônica para ordenar/buscar; pô-los no scraper agora forçaria um move depois.
- **Fixtures saem de `poc/` para `packages/test-fixtures`** — pacote privado só-dados com loader mínimo (`fixturePath()`/`loadFixture()`). Motivo: teste de contrato não pode depender de path dentro de `poc/` (histórico, arquivável um dia); resolução via workspace elimina `../../..` frágil e serve igual a testes de `shared` e do scraper. `poc/` mantém só os `.sample.html` anotados.
- Runner de teste: **Vitest** (ESM nativo, workspace-aware).
