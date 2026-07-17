# Escopo de run explícito: `scrape_runs.scope`, `crawl_state.store_id`, `p_scope_store_ids`

A Fase 1 só tinha `RunScope.kind = 'full'`: `pipeline_write_offers` desativava incondicionalmente
("toda oferta ativa da plataforma não tocada por este run") e `loadBaseline` do sanity fazia média
por `platform_id` sozinho. A Fase 2 introduz coleta tiered (`partial`) e bootstrap (também `partial`
— ver atualização de ADR-0001) coexistindo com sites `full` (inter, zoom, mycashback). Sem um
conceito explícito de "por quem este run é responsável", tanto o sanity quanto a desativação por
ausência ficam incorretos por construção assim que dois runs de tamanhos diferentes existem para a
mesma plataforma.

## Decisão 1 — `scrape_runs.scope`: coluna nova, não reaproveita `crawl_state.tier`

`scrape_runs` ganha `scope text not null` com 4 valores: `'full' | 'bootstrap' | 'active' | 'tail'`.
`loadBaseline` filtra por `(platform_id, scope)`, não só `platform_id` — sem isso, um run da fatia
cauda (~55 lojas) e um run do tier ativo (524/664 lojas) se misturam na mesma média móvel e disparam
`suspicious` um no outro sempre. Nome escolhido **`scope`**, não `tier`, para não sobrecarregar com
`crawl_state.tier` (colunas relacionadas, mas em tabelas com papéis diferentes — uma descreve o run,
outra descreve o estado por loja).

Duas regras de uso:

- **Runs são homogêneos em `scope`**: um run é `active` OU `tail`, nunca misto. Se o desenho do cron
  algum dia juntar as duas fatias num run só, este ADR precisa ser revisitado — o enum passaria a
  mentir sobre o que o baseline está medindo.
- **Bootstrap nunca aciona as regras 1/2 do sanity** (relativas ao baseline), mesmo depois de 3+ runs
  `scope='bootstrap'` acumulados. Dispatches de bootstrap têm tamanho arbitrário (retomada após
  interrupção, chunking variável) — comparar um contra o outro não tem o mesmo significado que
  comparar runs regulares do mesmo tier. Bootstrap só avalia a regra 3 (parse errors); a regra 4 não
  se aplica de qualquer forma (cuponomia/méliuz não têm `declaredTotal`).

## Decisão 2 — `crawl_state.store_id` como ponte + `p_scope_store_ids` explícito

`pipeline_write_offers` precisa saber, por run parcial, **quais `store_id` ela pode desativar** —
hoje ela varre a plataforma inteira, o que corrompe dois cenários concretos assim que `partial`
existir:

1. **Bootstrap retomado**: dispatch 2 (slugs 201–400) não pode desativar as ofertas que o dispatch 1
   (slugs 1–200) acabou de escrever — elas têm `last_seen_at` anterior ao início do dispatch 2 e "não
   foram tocadas" por ele.
2. **Cron regular pós-bootstrap**: um run `scope='active'` não toca nenhuma loja `tail` — não pode
   desativá-las por omissão.

`crawl_state` ganha `store_id bigint references stores(id)` (nullable). É escrita quando
`outcome='offer'` (usando o `store_id` que o `find-or-create` já resolveu) e **retida em todos os
desfechos posteriores** — nenhum caminho de código a limpa. É essa retenção que permite, num
`no_cashback` seguinte, saber qual `store_id` considerar para desativação (o `RawOffer` não existe
nesse desfecho, então não há `storeName` para resolver via `find-or-create`).

`pipeline_write_offers` ganha `p_scope_store_ids bigint[]` (nullable):

- `null` preserva o comportamento atual — desativa toda a plataforma não tocada. **Guarda**: a função
  levanta exceção se a plataforma tem qualquer linha em `crawl_state` e o parâmetro vier `null`. Não
  existe run `full` legítimo numa plataforma tiered — nem o bootstrap é `full` (decisão da atualização
  de ADR-0001). `null` ali é sempre bug do chamador, nunca um caso de negócio válido.
- Array fornecido (**inclusive vazio**) restringe a desativação a `store_id = any(p_scope_store_ids)`.

**Array vazio ≠ `null` — a armadilha central desta decisão.** Um run de fatia 100% `soft_block` (todo
slug bloqueado, nenhum desfecho real) produz um escopo vazio — nenhum `store_id` resolvido. Isso tem
que chegar à função como `[]`, nunca coalescido para `null` no lado TS. Se coalescer, um run
inteiramente bloqueado desativaria a plataforma inteira sob a semântica de "`null` = desativa tudo" —
o pior cenário possível (bloqueio vira apagão), disfarçado de bug de tipagem trivial.

O pipeline TS computa `p_scope_store_ids` como a união de `{store_id das ofertas escritas neste run}`
∪ `{crawl_state.store_id não-nulo dos slugs com desfecho no_cashback/not_found neste run}`.
`soft_block` nunca entra nesse conjunto — consistente com "soft_block não avança o relógio" (skill
`farejo-adapter`, lei 5).

## Testes obrigatórios (nomeados, não genéricos)

- Escopo vazio (`[]`) desativa nada — nem sequer é tratado como `null`.
- Bootstrap retomado: dispatch 2 não desativa as ofertas escritas pelo dispatch 1.
- Run `scope='active'` não desativa uma oferta residual de loja `tail`.
- `pipeline_write_offers` levanta exceção se a plataforma tem linhas em `crawl_state` e
  `p_scope_store_ids` vem `null`.

## Migration

Junta com a migration de `crawl_state` da Fase 2 (schema-base já esboçado em
`docs/farejo-system-design.md`, `crawl_state.store_id` é acréscimo desta decisão):
`crawl_state (platform_id, slug, store_id?, tier, last_checked_at, last_outcome)` +
`alter table scrape_runs add column scope text not null default 'full'` (backfill seguro: todas as
linhas existentes são de inter/mycashback, sempre `full`) + `pipeline_write_offers` com a assinatura
nova (`p_scope_store_ids bigint[]` adicionado, guarda de exceção implementada).
