# Bootstrap da coleta tiered

O bootstrap inicial de Cuponomia e Méliuz usa os diretórios públicos **apenas como
lista de slugs**. Ele não importa valores dos datasets históricos do POC: cada valor
vem da página pública da loja no momento do bootstrap e percorre a mesma pipeline dos
runs regulares.

## Ordem operacional

1. Aplique as migrations do Supabase.
2. Com o ambiente apontado ao projeto Supabase de destino, semeie os dois diretórios:

   ```sh
   pnpm --filter @farejo/scraper seed
   ```

   Para inspecionar ou refazer somente uma plataforma, use
   `SEED_PLATFORM=cuponomia` ou `SEED_PLATFORM=meliuz`. O seed só insere slugs ausentes:
   não duplica nem sobrescreve `tier`, `last_checked_at` ou `last_outcome` já gravados.

3. Rode um lote por vez de uma plataforma:

   ```sh
   BOOTSTRAP_PLATFORM=cuponomia pnpm --filter @farejo/scraper bootstrap
   BOOTSTRAP_PLATFORM=meliuz pnpm --filter @farejo/scraper bootstrap
   ```

   O lote padrão é 500 slugs (máximo aceito: 500). Ajuste para uma retomada menor com
   `BOOTSTRAP_BATCH_SIZE=100`.

4. Repita o comando enquanto a query de pendências abaixo retornar linhas. Cada execução
   consulta `crawl_state.last_checked_at IS NULL`; portanto interrupções e reexecuções
   pulam automaticamente os slugs com desfecho real. Um `soft_block` não preenche esse
   campo e volta no próximo lote, como deve ser.

5. Confira que não há pendências antes de habilitar o cron tiered:

   ```sql
   select platform_id, count(*) as pending
   from crawl_state
   where last_checked_at is null
   group by platform_id;
   ```

## Execução local e credenciais

Os comandos acima usam exatamente o mesmo scraper e pipeline do ambiente automatizado.
Por padrão apontam para o Supabase local; para executar contra o projeto hospedado,
crie um `.env` fora do Git com `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`. Isso é o
caminho de contingência quando o IP do GitHub Actions for bloqueado pelo site alvo.
