# Instrução de run explícita (`ScrapeInstruction`) + throttle adaptativo entre runs

`PlatformAdapter.scrape()` nasceu sem parâmetro (Fase 1: só `full`, sem estado entre runs). A
coleta tiered da Fase 2 quebra as duas premissas: (a) o runner precisa dizer ao adapter **qual
fatia visitar** (o dia da cauda, o tier ativo) sem dar acesso a DB ao adapter (ADR-0002: adapter só
extrai, nunca conhece Supabase); (b) sites que soft-bloqueiam sob taxa sustentada (cuponomia
confirmado; méliuz por precaução) precisam de uma defesa que se **adapta entre runs**, não só
dentro de um run — o circuit breaker (12 soft-blocks seguidos → aborta) já existia, mas era
estático e não deixava rastro utilizável: `runner.ts` gravava `softBlocks: 0` hardcoded em todo
run abortado, perdendo justamente o sinal que uma defesa adaptativa precisaria.

## Decisão 1 — `CircuitBreakerError` carrega estado parcial

`packages/shared/src/errors.ts` ganha `CircuitBreakerError extends Error`, com
`{ softBlocksSoFar: number; rawCountSoFar: number }`. O crawler de cuponomia/méliuz lança essa
classe (não `Error` genérico) ao bater 12 soft-blocks consecutivos. `runner.ts` distingue esse
`catch` de qualquer outro erro: grava os números reais em `scrape_runs` (ainda `status:'failed'`)
em vez de zerar `softBlocks`, e é o sinal inequívoco de "abortado pelo breaker" para a Decisão 3 —
sem inferir isso por mensagem de string.

## Decisão 2 — `platforms.throttle_multiplier`, coluna nova, não tabela nova

`platforms` (já existe, granularidade 1-linha-por-plataforma) ganha
`throttle_multiplier smallint not null default 1 check (throttle_multiplier in (1,2,4))`. O `check`
é rigidez **intencional**: mudar a escada (ex.: permitir 8×) exige uma migration consciente, não um
valor mágico solto em código. Para inter/zoom/mycashback o valor nunca sai de 1 — `softBlocks` é
sempre 0 nesses sites de 1 request, então a Decisão 3 é um no-op natural ali, sem tratamento
especial por tipo de site.

## Decisão 3 — regra de subida/descida, INTER-run (não intra-run)

Avaliada 1× no fim de cada run com desfecho, pelo runner, por plataforma:

- **Sobe** um nível (1→2→4, teto 4) se: o run foi abortado pelo breaker (`CircuitBreakerError`) OU
  `softBlocks / rawCount > 5%`.
- **Desce** um nível (4→2→1, piso 1) se o run completou com `softBlocks / rawCount < 2%`.
- **Mantém** entre 2% e 5% — histerese deliberada, evita oscilar a cada run.

Escalada **intra-run** (delay subir dentro do mesmo run conforme soft-blocks aparecem) foi avaliada
e **rejeitada como YAGNI**: duplicaria a proteção que o par circuit-breaker + throttle inter-run já
dá, e tornaria a duração de um run imprevisível (o `timeout-minutes` do Actions viraria chute em vez
de fórmula). Fica registrado como candidato futuro (variante com janela deslizante) se o throttle
inter-run se provar lento demais para reagir — não implementar agora.

## Decisão 4 — `ScrapeInstruction`: o parâmetro de entrada do `scrape()`

```ts
type ScrapeInstruction = {
  throttleMultiplier: 1 | 2 | 4;
  target:
    | { kind: "full" }                    // sites de 1 request e varreduras (inter, zoom, mycashback; bootstrap full não existe — ver ADR-0001)
    | { kind: "slugs"; slugs: string[] }; // fatia tiered: o tier ativo do dia, ou a fatia da cauda do dia
};

interface PlatformAdapter {
  platformId: string;
  scrape(instruction: ScrapeInstruction): Promise<ScrapeResult>;
}
```

O runner monta a instrução (lê `crawl_state` para a fatia do dia, lê `platforms.throttle_multiplier`)
— o adapter continua sem acesso a Supabase (ADR-0002 preservado). `delay_base` **não** entra na
instrução: é etiqueta específica do site, constante do adapter (1,3s cuponomia / 1,5s méliuz);
o delay efetivo que o adapter usa é `delay_base × throttleMultiplier`. Sites de 1 request recebem
`target: { kind: 'full' }` e ignoram `throttleMultiplier`.

**Simetria a explorar**: `instruction.target` (o que o runner mandou visitar) e `ScrapeResult.scope`
(o que foi visitado com desfecho real, ADR-0001) são espelhos. O pipeline pode validar um contra o
outro como sanity check barato — divergência (ex.: `target.slugs` tinha 55 itens,
`scope.slugs` devolveu 40) é sinal de que o adapter ignorou parte da instrução, não um caso de
negócio esperado.
