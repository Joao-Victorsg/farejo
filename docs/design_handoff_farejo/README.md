# Handoff visual: farejô

## Papel deste pacote

Este diretório é a referência visual do frontend público do farejô: estrutura das telas, hierarquia,
tokens, tipografia, espaçamentos, componentes, estados visuais, interações e tom.

Ele **não** é a fonte da verdade para schema, DTOs, busca, ordenação, cache, segurança, SEO,
persistência, aliases, logos, ativação ou deploy. Esses contratos ficam em
`../farejo-frontend-design.md`, `../farejo-system-design.md` e `../adr/`.

Os arquivos HTML são protótipos. Não copiar `support.js`, `renderVals()`, estado interno, dados
estáticos ou runtime para produção. Números, lojas e plataformas usados na demonstração são
ilustrativos; o produto real compara somente Méliuz, Cuponomia, MyCashback, Zoom e Inter.

## Fidelidade e viewport

- Alta fidelidade desktop: viewport de referência de 1440 px.
- Cores, tipografia, espaçamento, proporções, componentes e tom devem ser recriados fielmente.
- Logos de loja em tiles com inicial demonstram o fallback; produção usa logos reais quando houver.
- O handoff mobile de alta fidelidade será uma entrega posterior. Reflow funcional e acessibilidade
  em larguras menores são requisitos do frontend design, não uma composição definida aqui.
- O protótipo pode conter controles rotulados “HANDOFF” para alternar estados. Eles existem apenas
  para inspeção e não aparecem no produto.

Para inspeção visual, abrir `farejo-app-standalone.html`. `farejô Design System.dc.html` documenta os
componentes e tokens; `farejô App.dc.html` contém as telas editáveis do protótipo.

## Telas de referência

### Navegação global

- Barra branca sticky, borda inferior sutil.
- Marca à esquerda, links “Lojas”, “Plataformas”, “Como funciona” e “FAQ”.
- CTA “Buscar loja” à direita.
- Não existe “Entrar” ou “Criar conta”.

### Home `/`

- Hero com eyebrow monoespaçado, headline forte, subtítulo, busca e dois cards de estatística.
- Seção “Todas as lojas” com controles de ordenação e preferência “Correntista Inter”.
- Grade desktop de três colunas, gap de 16 px.
- Card de loja com logo/fallback, nome, quantidade de plataformas, melhor retorno e até três linhas
  de ofertas.
- Havendo mais ofertas, linha tracejada `+N` com “Ver todas”.
- Selos visuais: `MELHOR`, `BOOST`, `CONDICIONAL`, `VALOR FIXO` e atualização atrasada.
- Paginação abaixo da grade com anterior, páginas, próxima e estados ativo/desabilitado.
- Estado de busca sem resultados mantém a mesma linguagem visual.

### Loja `/loja/[slug]`

- Link de retorno ao catálogo.
- Header amplo com logo/fallback, nome, resumo de plataformas e melhor cashback.
- Ranking vertical: posição, ícone da plataforma, nome, sinais, nota, valor e CTA “Ativar”.
- A melhor linha usa superfície verde suave e CTA sólido; demais linhas usam superfície branca e CTA
  outline.
- Aviso informativo em superfície neutra abaixo do ranking.
- Seção “Histórico” com janela de 60 dias, legenda por plataforma, gráfico em degraus e resumo
  textual. O estado “Histórico sendo construído” usa a mesma área sem gráfico fabricado.
- Seção “Como funciona” com três passos.
- Não existe seção “Outras lojas populares”.

### Plataformas `/plataformas`

- Eyebrow e título de página.
- Texto introdutório curto.
- Grade de três colunas.
- Card com ícone, nome, quantidade de lojas, nota e dois mini-stats: média e pico.
- O Inter possui sinalização visual “Para correntistas”.

### Como funciona `/como-funciona`

- Título editorial e três passos horizontais numerados.
- CTA final em superfície escura levando à FAQ.

### FAQ `/faq`

- Título e introdução explicando que as plataformas pagam o cashback.
- Cards de perguntas e respostas com numeração/label monoespaçado.
- CTA final para buscar loja, reforçando que não há cadastro no farejô.

### Footer

- Fundo `#0d100e`.
- Marca clara, slogan e duas colunas: “Produto” e “Ajuda”.
- Barra inferior com copyright e disclaimer.
- Sem coluna “Legal”, Termos ou Privacidade nesta entrega.

## Interações visuais

- Cards de loja recebem borda/sombra no hover e levam ao detalhe.
- Botões, links, toggles, paginação e estados de foco seguem a linguagem do design system.
- “Ativar” indica abertura em nova aba.
- Nenhuma informação essencial depende somente de cor, hover ou tooltip.
- O protótipo demonstra aparência e transições; a semântica final de cada interação fica no frontend
  design.

## Design tokens

### Cores de marca e ação

- Verde primário `#1c7a4d` — CTAs, percentuais e destaques.
- Verde tint `#e7f4ec`; linha melhor `#f2f9f5`; borda positiva `#cfe7d9`.
- Verde-menta `#4ade9b` — acento em fundo escuro.
- Tinta `#12140f` — texto principal.

### Neutros

- Fundo `#fbfaf7`.
- Superfície `#ffffff`.
- Superfícies sutis `#f6f5f0` e `#faf9f5`.
- Bordas `#ece9e2` e `#e0ddd4`.
- Texto secundário `#5b5f56`.
- Texto apagado `#9a9d94` e `#8a8f84`.
- Escuro `#0d100e`; textos sobre escuro `#eef0ea`, `#9aa197` e `#7f867c`.

### Plataformas

- Méliuz `#ff2d6b`.
- Cuponomia `#0a66ff`.
- MyCashback `#7c3aed`.
- Zoom `#4163f1`.
- Inter `#ff6a00`.

### Tipografia

- **Hanken Grotesk** 400–800 — interface, títulos e nomes.
- **Space Grotesk** 400–700 — números, percentuais e estatísticas.
- **Geist Mono** 400–500 — eyebrows, labels, selos e ranking.

Escala aproximada: hero 54 px; títulos de seção 24–46 px; nomes 17–32 px; corpo 14–18 px; labels
9–13 px.

### Sinais

- `MELHOR`: fundo `#e7f4ec`, texto `#1c7a4d`.
- `BOOST`: fundo `#c05f2b`, texto branco.
- `CONDICIONAL`: fundo `#dcebe3`, texto `#2f6f57`.
- `VALOR FIXO`: fundo `#f0e7d3`, texto `#8a6a33`.
- `ATRASADO`: creme/amarelo discreto, sempre acompanhado por texto.

Na home, manter no máximo um sinal secundário por linha; no detalhe há espaço para todos os sinais
aplicáveis. `MELHOR` permanece o destaque principal.

### Forma e espaço

- Radius: plataforma 7 px; loja/botão 10–12 px; card 14–20 px; pílula 100 px.
- Escala de espaço: 4, 8, 12, 16, 24 e 40 px.
- Hover de card: `0 10px 30px -18px rgba(0,0,0,.25)`.
- Busca: `0 6px 24px -14px rgba(0,0,0,.25)`.

## Assets e arquivos

- `farejô App.dc.html` — protótipo visual editável.
- `farejô Design System.dc.html` — sistema de design.
- `farejo-app-standalone.html` — referência navegável offline.
- `support.js` — runtime exclusivo do protótipo; não usar em produção.
- Assets da marca incorporados/exportados pelo pacote — marca, favicon e versões claras.

Logos finais de lojas vêm do Supabase Storage e ícones das cinco plataformas são assets fixos do
frontend. O handoff define sua apresentação, não o pipeline de ingestão.
