---
name: farejo-typescript
description: >
  Padrões TypeScript do farejô que linter/tsconfig NÃO pegam. Use ao escrever qualquer
  código TS no monorepo (scraper, pipeline, web, testes): validação de dados externos,
  modelagem de reward/oferta, parsing de texto pt-BR (valores, acentos), testes com
  fixtures, ou ao revisar PR que toque em tipos do domínio.
---

# TypeScript no farejô

O que ferramenta já garante, ferramenta garante (não repita aqui): `tsconfig` strict +
`noUncheckedIndexedAccess` (preset do TSConfig Cheat Sheet), `typescript-eslint`
`strict-type-checked`, `knip`. Esta skill cobre só o que escapa delas.

## 1. Fronteiras: zod, e o tipo deriva do schema

Todo dado que entra de fora valida com zod ANTES de virar tipo do domínio: JSON da API
do inter, flight RSC do zoom, data-attributes do cuponomia, env vars, linha de JSONL.

```ts
const InterStore = z.object({ slug: z.string(), fullCashbackValue: z.number(), /* … */ });
type InterStore = z.infer<typeof InterStore>;   // ✅ deriva
// ❌ nunca: declarar a interface na mão E validar por fé (as InterStore)
```

Falha de validação em item individual = `parse_error` contado (alimenta o sanity check),
não crash da run.

## 2. Domínio: discriminated unions, nunca campos opcionais para variantes

```ts
type Reward =
  | { type: 'percent'; value: number; isUpto: boolean }
  | { type: 'fixed';   value: number; currency: 'BRL' };
// ❌ { value: number; currency?: string; isUpto?: boolean } — variante por adivinhação
```

Regra de negócio associada: `percent` e `fixed` nunca se comparam/ordenam juntos
(`percent` sempre primeiro). O tipo deve tornar a comparação acidental difícil.

`value_partial` (não-correntista do inter) é **número simples**, não um segundo `Reward`:
é sempre `percent`, mesma moeda e mesmo `isUpto` do full — modelar como `Reward` completo
seria over-modeling. O pipeline parseia `partialRewardText` e guarda só o `value`.

## 3. `null` ≠ erro (a distinção que salva o crawl)

Três desfechos, três semânticas distintas — nunca colapsar:
- `null` → desfecho real "não é oferta" (sem cashback, 404 verdadeiro);
- **throw `RetryableError`** → bloqueio/anomalia (200 sem sinal de presença, timeout);
- **throw `ParseError`** → o texto chegou mas não casa com nenhum formato conhecido
  (`parseReward` de um `rewardText` que já passou pelo filtro de inativa = o site mudou).
  Não é retentável e não é `null`: o pipeline **conta em `parse_errors`** (alimenta o
  sanity check) e segue — só derruba a run se passar de 10%.

Colapsar `null` com `RetryableError` transforma soft-block em "loja sem cashback" — foi nosso
pior bug. Colapsar `ParseError` com `RetryableError` faz o pipeline retentar um site que
mudou de layout (nunca vai se resolver sozinho). O chamador decide retry/backoff/abort/contar;
o parser só classifica.

## 4. Texto pt-BR: as armadilhas concretas

- **`\b` não funciona após letra acentuada**: `/\bat[ée]\b/` dá false em `"Ativar até 10%"`.
  Remova acentos ANTES de aplicar limite de palavra.
- **Vírgula decimal**: `"4,5%"`, `"0,01500"`, `"R$ 8,5"` — use o helper compartilhado
  (`brNum`), nunca `parseFloat` direto.
- **Prefixos que quebram parse**: `"até 4%"`, `"Até* 20%"` — strip antes do número.
- **Espaços duplos existem em produção**: `"Sem  Cashback"` — matche com `\s+`.
- Frações → percentual: `bestFormula * 100` gera ruído binário; corte com `toFixed(4)`.

## 5. `as` é proibido fora de teste; em teste, shoehorn

Produção: `as` só em `as const`. Se precisa de `as`, falta um type guard ou um schema.
Testes: montar objetos parciais com `@total-typescript/shoehorn` (`fromPartial`),
nunca `as InterStore`.

## 6. Async em crawls

`no-floating-promises` é lei (o crawl é um loop async longo). Sem `Promise.all` em
requests ao MESMO site (rate limit sequencial ≥1,3s); `Promise.all` ok entre sites
diferentes. `AbortSignal.timeout()` em todo fetch.

## 7. Nomes vêm da linguagem ubíqua

`boost`, `softBlock`, `tier`, `canonicalStore`, `alias`, `presenceSignal`, `upTo` —
usar os termos do CONTEXT.md (quando existir) / AGENTS.md. Não inventar sinônimos
(`promo`, `blocked`, `group`): o vocabulário compartilhado é o que mantém o código
navegável para humanos e agentes.
