# Curadoria de aliases versionada no Git; Supabase materializa o estado operacional

A Fase 3 precisa revisar matches fuzzy sem permitir auto-merge. Como `/admin/aliases` está fora
do escopo, a decisão humana não ficará numa fila de candidatos no Supabase nem num relatório
paralelo: ficará em um manifesto versionado no Git. O histórico de commits é o registro auditável
da curadoria.

## Decisão

O manifesto registra dois tipos de decisão:

- `merge`: associa os nomes crus por plataforma a uma loja canônica;
- `reject`: memoriza que um par foi revisado e não deve ser proposto novamente pelo fuzzy.

As decisões usam identificadores estáveis — `platform_id`, nome cru e slug canônico —, nunca o
`stores.id` numérico do Supabase, que pode variar entre ambientes.

O Supabase recebe somente o estado operacional aplicado: lojas canônicas, aliases confirmados,
ofertas e redirects de slug. O frontend nunca consulta o Git em runtime e não cruza duas fontes;
ele lê apenas o Supabase. A URL de ativação de cada plataforma continua vindo de `offers.url` —
`store_aliases` existe para consolidar a ingestão, não para redirecionar o usuário à plataforma.

## Identidade após um merge

Toda decisão de `merge` declara explicitamente o `canonicalSlug`. A loja canônica escolhida
preserva nome e logo; o merge não os substitui automaticamente por first-writer, score fuzzy ou
prioridade implícita de plataforma.

Slugs das lojas absorvidas não desaparecem: tornam-se redirects permanentes para o slug canônico.
Assim, uma URL pública já compartilhada ou indexada continua resolvendo depois da curadoria.

## Consequências

- Candidatos fuzzy são transitórios: não participam da leitura pública e não precisam de tabela no
  Supabase. Uma execução de curadoria pode propor diretamente um diff no manifesto.
- Rejeições também são conhecimento de domínio e ficam versionadas; omiti-las faria o mesmo par
  reaparecer em toda execução fuzzy.
- A aplicação do manifesto ao Supabase precisa ser idempotente e transacional, inclusive ao mover
  aliases, ofertas, histórico, referências de crawl e propriedade do logo.
- O banco é uma projeção operacional das decisões do Git. Divergência entre o manifesto e o estado
  aplicado é erro de sincronização, nunca algo que o frontend resolve em runtime.
- O merge falha fechado se duas lojas do cluster já têm oferta na mesma plataforma. A Fase 3 não
  escolhe automaticamente por maior valor, URL mais recente ou first-writer: o humano registra
  `reject` ou adia a decisão. Resolver duas observações conflitantes da mesma plataforma fica fora
  deste contrato até aparecer um caso real que justifique modelá-lo.
