# Indexação separa catálogo paginado de busca

## Contexto

O catálogo público usa paginação por URL e também aceita busca por `?q=`. Embora ambos reutilizem a
mesma grade, a paginação representa partes estáveis do catálogo, enquanto combinações de busca
produzem variações potencialmente ilimitadas e duplicadas. As páginas de loja também podem mudar de
slug por curadoria ou permanecer temporariamente sem oferta elegível.

## Decisão

São indexáveis `/`, `/plataformas`, `/como-funciona`, `/faq` e a página canônica
`/loja/[slug]` quando a loja tem ao menos uma oferta pública elegível.

Cada página válida do catálogo em `?page=N` é uma URL indexável, ligada às páginas adjacentes por
links HTML reais e com canonical absoluto para si própria. `?page=1` redireciona para `/`. Página
inexistente ou além do total não é transformada silenciosamente em outra página válida.

Qualquer resultado com `?q=`, inclusive combinado com paginação, recebe `noindex,follow` e não entra
no sitemap. A busca continua navegável e compartilhável, mas não cria um índice de combinações de
consulta.

Uma loja canônica temporariamente sem oferta elegível mantém a resposta `200` e o estado público de
indisponibilidade já decidido, porém recebe `noindex` e é removida do sitemap. Um slug absorvido faz
redirecionamento permanente para o slug canônico.

O sitemap gerado pelo Next.js contém somente as rotas institucionais, a raiz e as lojas canônicas
elegíveis. A rota `/go/...` não integra o sitemap e é bloqueada no `robots.txt`, para que rastreadores
não provoquem redirecionamentos que possam parecer ativações.

## Consequências

- O catálogo paginado permanece rastreável sem canonicalizar todas as páginas para a raiz.
- Consultas de busca não multiplicam páginas duplicadas nos mecanismos de busca.
- A curadoria de aliases preserva autoridade por meio de redirect permanente.
- A elegibilidade pública também governa sitemap e metadados da página de loja.
- Sitemap, canonical, robots e paginação precisam ser verificados em preview antes do lançamento.
- A telemetria de ativação continua best-effort e não deve depender somente do `robots.txt` para
  distinguir tráfego humano de automação.
