# Rotas que decidem 404 ou redirect não têm `loading.tsx` próprio

## Contexto

Um `loading.tsx` cria uma fronteira de Suspense **no nível da rota**. Em páginas `force-dynamic`,
o Next transmite esse shell imediatamente: a linha de status 200 já está no fio quando a página
resolve. `notFound()` e `permanentRedirect()`, que rodam depois, não conseguem mais definir o
status — degradam para HTTP 200 com `meta refresh` e com o 404 no payload RSC (#101).

O arquivo estava na raiz de `app/`, então valia para toda a árvore. Em produção isso significava
soft-404 em todo `/loja/<slug-inexistente>` e os 47 redirects de alias já mesclados chegando como
`meta refresh` em vez de 308 — sem consolidar o sinal de link que a curadoria (ADR-0006) existe
para produzir.

## Decisão

O esqueleto passa a viver em `app/(catalogo)/loading.tsx`, junto de `app/(catalogo)/page.tsx`.
Route group não altera URL: a home continua em `/` e mantém o esqueleto. Todas as demais rotas
deixam de ter fronteira no nível da rota e voltam a responder o status real.

`/loja/[slug]` e `/plataformas` **não** ganham `loading.tsx` próprio. Não é limitação técnica —
medido, um `<Suspense>` **abaixo** dos `await` que decidem 404/308 preserva o status e ainda
transmite o fallback. É que não há espera a preencher. Tempo até a resposta completar, medido
contra a produção real em 23/07/2026 (o `total` de hoje é o TTFB depois desta mudança):

| Rota | Fria | Morna |
| --- | --- | --- |
| `/loja/adidas` | 148ms | 69–82ms |
| `/loja/1password` | 126ms | 72–82ms |
| `/loja/lifeextension` | 93ms | 60–85ms |
| `/loja/zzmall` | 85ms | 51–59ms |
| `/plataformas` | 354ms | 70–84ms |
| `/` (mantém esqueleto) | 230ms | 95–107ms |

Um esqueleto que aparece por menos de 150ms não é feedback de carregamento, é um flash — pior que
a ausência dele. A home fica com o seu por ser a mais lenta e a única que se beneficia.

Se um dia alguma dessas páginas ficar lenta o bastante para justificar, a fronteira vai **abaixo**
da checagem de existência — `<Suspense>` dentro da página, depois dos `await` que decidem 404/308 —
nunca num `loading.tsx`.

## Consequências

- `/loja/<inexistente>` volta a responder 404 real, e o redirect de alias, 308 real.
- O smoke de produção passa a exigir os dois de forma estrita. Um `loading.tsx` reintroduzido em
  `/loja/[slug]` reprova a publicação em vez de reabrir a #101 em silêncio; a mensagem do check
  aponta a causa, porque o sintoma (200 onde se esperava 404) não a sugere sozinho.
- A canonicalização do catálogo (`/?page=1`, `/?sort=platforms`) continua chegando por
  `meta refresh`, porque a home mantém o esqueleto de propósito. O `<link rel="canonical">` já
  cobre o SEO dessas URLs, e a paginação nunca emite `page=1` — o custo é ~1s para quem digita a
  URL à mão. O smoke aceita as duas formas ali, por decisão e não por tolerância.
- `/loja/[slug]` e `/plataformas` param de exibir o esqueleto **da home** (hero + grade de cards),
  que não correspondia a nenhuma das duas telas.
- A restrição é sobre um arquivo que não deve existir, então não há código onde comentá-la; o
  aviso fica em `(catalogo)/loading.tsx`, que é onde alguém olha ao copiar o padrão.
