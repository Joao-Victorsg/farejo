# Conteúdo editorial fica versionado no Git

## Contexto

As páginas públicas combinam dados operacionais que mudam após os scrapes com textos editoriais
estáveis, como hero, FAQ, explicações, disclaimers e descrições das plataformas. Colocar todo o
conteúdo no banco confundiria essas responsabilidades e criaria fluxo de edição, permissões e
dependência de runtime sem haver CMS, equipe editorial ou painel administrativo no escopo.

Por outro lado, números e estados reais não podem permanecer como exemplos estáticos do protótipo.

## Decisão

O Supabase é a fonte de dados operacionais: lojas, ofertas, histórico, logos, datas, frescor,
contagens e estatísticas derivadas. Nenhum número do catálogo necessário para reproduzir o produto é
copiado manualmente para o frontend.

Textos editoriais ficam versionados no Git em módulos tipados ou arquivos MDX centralizados. Isso
inclui títulos e subtítulos do hero, FAQ, “Como funciona”, disclaimers, chamadas para ação e
descrições estáveis das cinco plataformas. Esses textos não ficam espalhados como literais pelos
componentes e podem ser reutilizados em conteúdo visível e metadados da página.

Não haverá CMS, tabela genérica de conteúdo nem painel de edição na Fase 3. Alterações editoriais
passam por revisão no repositório e entram com um novo deploy. O ano do rodapé e outros valores
puramente derivados do runtime não são mantidos manualmente.

## Consequências

- O banco não ganha tabelas, roles ou rotas de escrita para conteúdo raramente alterado.
- O histórico do Git registra quem mudou textos e permite revisar ou reverter a alteração.
- O site continua usando dados reais para todos os números e estados do catálogo.
- Uma mudança editorial exige deploy, o que é aceitável sem um fluxo de edição não técnico.
- Componentes recebem conteúdo estruturado e não dependem de strings de demonstração do handoff.
- Se surgir uma necessidade real de edição sem deploy, um CMS poderá substituir essa fonte sem
  mover o catálogo operacional para ele.
