# farejô — Decisões de frontend

Consolidado em 16/07/2026 após o `grill-with-docs` da Fase 3.

## Precedência e papel do handoff

- `design_handoff_farejo/` é a fonte da verdade para composição visual desktop, tokens, tipografia,
  espaçamentos, componentes, interações e tom.
- Este documento e as ADRs são a fonte da verdade para comportamento, dados, segurança, cache, SEO,
  estados e critérios de aceite.
- O standalone é um protótipo navegável. Seus números, lojas, plataformas, controles de demonstração
  e runtime são ilustrativos; não são contrato de dados nem código para copiar.
- As migrations são a fonte da verdade do schema já implementado. Mudanças aprovadas para a Fase 3
  entram por novas migrations.

O aceite de alta fidelidade atual usa viewport de 1440 px. O desktop permanece funcional entre 1024
e 1439 px. Abaixo disso existe reflow funcional e acessível, mas o design mobile de alta fidelidade é
uma entrega posterior ([ADR-0044](adr/0044-mobile-e-adiado-e-desktop-define-a-primeira-entrega.md),
[ADR-0051](adr/0051-aceite-visual-desktop-usa-1440-pixels.md),
[ADR-0052](adr/0052-larguras-menores-tem-reflow-funcional-antes-do-handoff-mobile.md)).

## Escopo público

Rotas visuais:

- `/` — catálogo completo, busca, ordenação e paginação;
- `/loja/[slug]` — ranking completo, histórico e ativação;
- `/plataformas` — panorama agregado das cinco plataformas;
- `/como-funciona`;
- `/faq`.

O produto não possui login. Só existem Méliuz, Cuponomia, MyCashback, Zoom e Inter. Tema escuro,
`/admin/aliases`, “Outras lojas populares”, Termos e Privacidade ficam fora desta entrega. Não existe
API pública própria; `/api/search` não é necessária.

## Catálogo, busca e ordenação

- A home lista toda loja canônica com ao menos uma oferta pública elegível, 24 por página.
- A ordem padrão é “Mais plataformas”: cobertura decrescente, nome e slug.
- “Maior cashback” coloca lojas com percentual antes das lojas exclusivamente fixas. Dentro de cada
  grupo usa o maior valor; nunca converte nem compara `%` com `R$`. Para estabilidade, a taxa Inter de
  referência é sempre a de correntista.
- “A–Z” usa nome canônico e slug.
- `q`, `page` e `sort` fazem parte da URL. A ordem padrão pode omitir `sort`; trocar busca ou ordem
  volta à página 1.
- Com busca, relevância vem antes da ordenação escolhida: nome exato, alias exato, prefixo, substring
  e trigram. Fuzzy recupera resultados; nunca cria ou mescla aliases.
- Busca ocorre sobre o catálogo inteiro antes da paginação e continua paginada quando excede 24
  resultados.
- O hero usa dados reais. A quantidade de lojas é arredondada para baixo em centenas (`1063` →
  `1.000+`; `1199` → `1.100+`); abaixo de 100 usa o número exato. Plataformas = 5.

URLs do catálogo padrão são indexáveis. Busca e ordenações alternativas são compartilháveis, mas
`noindex,follow`. `sort=platforms` é normalizado para a URL sem o parâmetro.

## Cards, ranking e preferência Inter

- O card abre `/loja/[slug]`; “Ativar” abre uma nova aba.
- O card recebe todas as ofertas elegíveis, resolve o ranking no cliente e mostra até três linhas.
  Havendo mais, exibe `+N` e leva ao detalhe.
- Percentuais sempre precedem valores fixos; “Até X%” permanece sinalizado.
- Uma loja em apenas uma plataforma é normal.
- O toggle “Correntista Inter” começa ligado, persiste em `localStorage` e aparece na home e junto ao
  cabeçalho do ranking no detalhe. Os dois controles representam a mesma preferência.
- Alternar o Inter troca apenas `value`/`value_partial`, reordena ofertas dentro da loja, atualiza
  destaques e seleciona a série histórica correspondente. Nunca move lojas, muda página ou altera a
  URL do catálogo.

## Detalhe, histórico e sinais

- Slug absorvido por curadoria redireciona permanentemente ao canônico.
- Slug inexistente responde 404.
- Loja canônica sem oferta elegível mantém a página com estado indisponível e sem CTA; não vira 404.
- Histórico cobre 60 dias, usa gráfico em degraus, inclui a âncora anterior à janela e representa
  desativação como lacuna. Percentual e valor fixo usam escalas separadas.
- Sem ao menos uma mudança real, a seção mostra “Histórico sendo construído”. Não há interpolação ou
  dados fabricados em produção.
- Boost é derivado da mediana ponderada pelo tempo nos 60 dias. Valor anterior não define boost.
- Valor anterior só aparece quando há evidência nativa ou intervalo anterior verdadeiro. Validade só
  aparece quando a fonte fornece uma data explícita; nunca é inferida.

## Frescor e estados

- Até 24 h: oferta normal.
- Entre 24 h e 48 h: oferta marcada como “Atualização atrasada”, ainda elegível e ativável.
- Acima de 48 h: oferta excluída das superfícies públicas.
- Datas usam pt-BR e `America/Sao_Paulo`; datas absolutas usam `dd/MM/yyyy`.

Estados distintos:

- skeleton inicial;
- busca sem resultado;
- catálogo sem lojas elegíveis por anomalia;
- erro de servidor/banco com tentativa novamente;
- loja canônica indisponível;
- histórico sendo construído;
- oferta atrasada.

Controles “HANDOFF”, debug ou seletores artificiais de estado existem somente no protótipo e nunca
entram no build público.

## Ativação

O DTO entrega ao CTA apenas `/go/[storeSlug]/[platformId]`. A rota server-side faz uma consulta curta
e sem cache para revalidar atividade, frescor e destino antes do redirect. `offers.url` não integra o
DTO da página.

- Sucesso: redirect temporário para a plataforma; telemetria agregada é best-effort e não bloqueia.
- Oferta encerrada/removida/expirada: `410`, “Esta oferta não está mais disponível”, retorno à loja.
- Falha temporária: `503`, “Não conseguimos validar esta oferta agora”, tentar novamente e retorno.
- Nunca reutilizar URL antiga como fallback.

Meta de performance: p95 abaixo de 500 ms e timeout total de 1,5 s.

## Página de plataformas

- Quantidade de lojas inclui ofertas percentuais e fixas.
- Média e pico usam somente percentuais; cada loja tem o mesmo peso.
- “Até” continua explícito no pico.
- Inter usa taxa de correntista em todos os agregados e recebe rótulo “Para correntistas”.

## Leitura, segurança e DTO

O navegador nunca consulta o Supabase. Server Components e código `server-only` na Vercel conectam
ao Postgres pelo Supavisor transaction mode com a role somente leitura `farejo_web`.

- `farejo_web` enxerga apenas views estreitas e não materializadas de `web_read`.
- `web_read` não é exposto pelo Data API.
- `anon` e `authenticated` não recebem leitura pública.
- `service_role` permanece exclusiva do pipeline e nunca existe na Vercel ou no browser.
- DTOs são allowlists de apresentação: não incluem `raw_text`, fontes de logo, hashes, aliases,
  candidatos, runs, crawl state ou URLs externas antecipadas.
- Preview não acessa banco remoto; produção é o único ambiente remoto nesta fase.

## Cache e publicação

Leituras derivadas do catálogo usam a tag ampla `catalog`, com TTL aproximado de uma hora como rede
de segurança. Depois de cada escrita aceita de scrape, mudança de aliases ou troca do logo final, um
`POST` interno autenticado por HMAC-SHA-256 expira a tag imediatamente. O primeiro acesso reconstrói
com dados novos; não serve conteúdo antigo durante a revalidação.

Publicação usa um workflow único: testes/build, migrations aditivas, verificação de grants e views,
deploy do mesmo artefato e smoke tests. Não há staging remoto; previews ficam sem banco. Node, Next.js
e React usam as versões estáveis mais recentes compatíveis com a Vercel, fixadas no monorepo.

## Logos e aliases

- Um único logo final por loja canônica, WebP quadrado ~128 px no bucket público `store-logos`.
- Fontes observadas são privadas e deduplicadas por loja/plataforma; o scrape apenas persiste URLs.
- Uma Action separada, automática após o scrape, seleciona, normaliza e publica logos. Falha mantém o
  logo anterior ou o fallback de tile e inicial.
- Ícones das cinco plataformas são assets fixos versionados.
- Aliases são curados em manifesto no Git. Regras determinísticas, trigram e IA apenas propõem
  candidatos; nunca fazem auto-merge. Revisão humana e merge do PR autorizam a aplicação automática.

## Stack e identidade

- TypeScript, Next.js App Router, React, Tailwind, shadcn/ui, Lucide, Supabase e Vercel.
- Hanken Grotesk para interface, Space Grotesk para números e Geist Mono para labels.
- Tema claro; verde primário `#1c7a4d`, tinta `#12140f`, fundo `#fbfaf7` e footer `#0d100e`.
- Recriar componentes e comportamento; não copiar HTML, `support.js`, `renderVals()` ou dados do
  protótipo.

As justificativas e consequências completas permanecem em `docs/adr/`, especialmente ADRs 0006 a
0053.
