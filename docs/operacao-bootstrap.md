# Bootstrap da coleta tiered

O bootstrap inicial de Cuponomia e Méliuz usa os diretórios públicos **apenas como
lista de slugs**. Ele não importa valores dos datasets históricos do POC: cada valor
vem da página pública da loja no momento do bootstrap e percorre a mesma pipeline dos
runs regulares.

## Ordem operacional

1. Aplique as migrations do Supabase.
2. No GitHub, abra **Actions → Seed crawl state → Run workflow**, mantenha
   `all` para os dois diretórios (ou escolha uma plataforma para uma reexecução).
   O workflow é exclusivamente manual: usa os GitHub Secrets e não possui cron.
   Ele só insere slugs ausentes e não sobrescreve estado já processado.

   Como contingência local, com o ambiente apontado ao projeto Supabase de destino,
   execute:

   ```sh
   pnpm --filter @farejo/scraper seed
   ```

   Para inspecionar ou refazer somente uma plataforma, use
   `SEED_PLATFORM=cuponomia` ou `SEED_PLATFORM=meliuz`. O seed só insere slugs ausentes:
   não duplica nem sobrescreve `tier`, `last_checked_at` ou `last_outcome` já gravados.

3. No GitHub, abra **Actions → Bootstrap tiered crawlers → Run workflow**, escolha
   `cuponomia` ou `meliuz` e deixe o lote em `500` (ou use `100`/`250` para uma
   retomada menor). O workflow é manual, fica fora do cron regular e tem timeout de
   90 minutos. Ele usa o mesmo grupo de concorrência da plataforma, portanto não
   sobrepõe o cron nem outro bootstrap.

4. Repita o dispatch enquanto a query de pendências abaixo retornar linhas. Cada
   execução consulta `crawl_state.last_checked_at IS NULL`; portanto interrupções e
   reexecuções pulam automaticamente os slugs com desfecho real. Um `soft_block` não
   preenche esse campo e volta no próximo lote, como deve ser.

5. Confira que não há pendências antes de habilitar o cron tiered:

   ```sql
   select platform_id, count(*) as pending
   from crawl_state
   where last_checked_at is null
   group by platform_id;
   ```

## Contingência local

O dispatch do Actions é o caminho padrão e também a validação inicial de que o IP de
datacenter passa pelos portais. Se ele falhar repetidamente por bloqueio de IP, siga
o [runbook de bloqueio persistente](operacao-bloqueio-ip.md) e execute o mesmo lote da
máquina local:

   ```sh
   BOOTSTRAP_PLATFORM=cuponomia pnpm --filter @farejo/scraper bootstrap
   BOOTSTRAP_PLATFORM=meliuz pnpm --filter @farejo/scraper bootstrap
   ```

   O lote padrão é 500 slugs (máximo aceito: 500). Ajuste para uma retomada menor com
   `BOOTSTRAP_BATCH_SIZE=100`.

Os comandos usam exatamente o mesmo scraper e pipeline do Actions. Por padrão apontam
para o Supabase local; para executar contra o projeto hospedado, crie um `.env` fora do
Git com `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.
