# O smoke de produção afirma conteúdo, e "não verificado" é distinto de falha

## Contexto

A F3/T18 (ADR-0041) fechou a publicação com um smoke pós-deploy, e a ADR-0056 o redirecionou para
o deployment encenado, antes da promoção. Em 23/07/2026, ao ampliar sua cobertura para as rotas
que faltavam (`/plataformas`, `/como-funciona`, `/faq`, paginação, ordenações, redirect de alias e
os negativos), duas propriedades do desenho original se mostraram falsas.

`/` e `/plataformas` capturam a falha de leitura do Postgres e renderizam um estado de erro
editorial — `HomeError`, `PlatformsError` — com HTTP **200**. Um check que só compara
`response.status === 200` aprova, portanto, um deployment servindo o site inteiro quebrado.
Verificado renomeando `web_read.catalog_search` no Postgres local: todas as rotas seguiam
respondendo 200.

O check de ativação aceitava `307|410|503`. O link testado é extraído de uma página de detalhe
renderizada **com oferta ativa**, então o único desfecho correto é o redirect; aceitar 503 fazia
uma queda do Postgres passar como sucesso e ser promovida.

Havia ainda um ponto cego estrutural. O toggle de correntista é cliente puro (ADR-0034), então o
HTML servido é idêntico com ou sem JavaScript funcionando. Servindo o site com todos os chunks JS
respondendo 404, o smoke HTTP passou 60 de 60 checks.

E, ao cobrir rotas que dependem de dado de produção, apareceu uma terceira questão: o redirect de
alias não pode ser verificado antes de existir o primeiro merge mesclado. Tratar isso como falha
reprovaria publicações legítimas; tratar como sucesso silencioso afirmaria uma verificação que não
aconteceu.

## Decisão

**Status nunca basta sozinho.** Toda rota com estado de erro próprio afirma conteúdo esperado e
recusa explicitamente o texto do próprio fallback. Nas páginas `force-dynamic`, a asserção só vale
depois de o conteúdo real substituir o `loading.tsx` — a mesma guarda anti-esqueleto já usada no
smoke local, casando a tag renderizada e não a substring (o Next embute uma cópia escapada no
payload RSC).

**A ativação no caminho feliz é 307 estrito**, com destino `https:`. O 410 é induzido de fora com
um par forjado, que é determinístico porque `activation.resolve_destination` é um `select … limit
1`. O 503 **não** é induzido: exigiria derramar o Postgres de produção, e simulá-lo seria
encenação — fica coberto no teste da rota, e o smoke garante a inversa, que um 503 real reprova.

**"Não verificado" é um terceiro resultado, distinto de falha.** Quando a verificação depende de
dado que produção ainda não tem — nenhum merge de alias declarado, catálogo com uma única página —
o check sai marcado como informativo: não reprova a publicação, e o relatório diz **o que ficou sem
ser verificado**. Nunca é usado para suavizar um desfecho ruim.

**O smoke prova o artefato publicado; não rededuz semântica de domínio.** Ordenação, relevância e
paginação continuam sendo provadas contra o SQL real nos testes de banco; o 503 de ativação, no
teste da rota. Aqui a pergunta é apenas se o deployment recém-criado serve essas rotas contra o
banco de produção. Asserções acopladas a classe CSS ficam proibidas: quebram em qualquer mudança
de estilo, e o alarme falso cairia no caminho de publicação.

**A hidratação ganha uma camada própria de browser**, no mesmo deployment encenado e antes da
promoção. A asserção central é a interação — se o bundle não hidratou, o clique no toggle não
altera `aria-checked`. Erros de console entram como diagnóstico, nunca como reprovação: script de
terceiro falhando num deployment encenado não é regressão do produto.

**O redirect de alias não exige secret nem artefato novo.** `stores.slug` é a chave L2 do nome cru,
então o par (slug absorvido → canônico) é derivável com `l2Key` sobre o manifesto já versionado no
Git. Um par declarado que responda "loja não encontrada" conta como não verificado — é fato de
curadoria, não regressão de deploy.

**A amostra de lojas vem da home antes do sitemap.** Os cards da home estão ordenados por cobertura
("Mais plataformas"), então concentram as lojas presentes em mais plataformas; o sitemap está em
ordem alfabética e abre pela cauda longa. Medido contra a produção real: 8 de 8 das primeiras lojas
da home tinham oferta do Inter, contra 1 de 8 das primeiras do sitemap. Amostrar só o sitemap
zerava, em produção, a cobertura do toggle e a do smoke de browser inteiro. As duas fontes ficam na
amostra, para continuar provando que um slug listado no sitemap resolve.

**Existe um modo somente-leitura** (`FAREJO_SMOKE_READ_ONLY=1`), para apontar o smoke a uma
produção já no ar sem alterá-la. Ele desliga exatamente os dois checks que gravam: o bloco de
`/go/`, cujo redirect agenda `recordActivation` e incrementa `activation_metrics` de uma loja real,
e o POST de invalidação, que expira a tag `catalog`. Os dois saem como não verificados. O workflow
de publicação nunca usa esse modo — lá os dois efeitos são desejados, e o deployment encenado ainda
não recebeu tráfego.

**Enquanto a #101 estiver aberta**, os checks de redirect e de loja inexistente aceitam tanto o
status forte (3xx/404) quanto a forma degradada que o streaming produz hoje (200 + `meta refresh`,
404 no payload RSC), e registram qual observaram. Fixar o status forte deixaria a publicação
vermelha por uma condição pré-existente; aceitar qualquer 200 deixaria a perda total do redirect
passar despercebida.

> **Superado pela ADR-0060 (23/07/2026).** A #101 foi corrigida escopando o `loading.tsx` ao route
> group da home, então `/loja/*` voltou a responder status real e os checks daquelas rotas passaram
> a exigi-lo: 404 estrito para loja inexistente, 308 estrito para alias absorvido. A tolerância
> permanece **apenas** na canonicalização do catálogo, onde a home mantém o esqueleto de propósito
> — ali as duas formas são aceitas por decisão, não por espera.

## Consequências

- Uma queda de leitura do Postgres reprova a publicação em vez de ser promovida: 13 checks passam a
  falhar no cenário que antes passava inteiro.
- Um artefato cujo bundle não hidrata é reprovado antes de chegar ao público — cenário que o passo
  HTTP não alcança por construção.
- O relatório distingue três estados (`ok`, `falha`, `não verificado`) e fecha com a contagem dos
  três, então uma cobertura que encolheu por falta de dado fica visível em vez de se disfarçar de
  aprovação.
- O smoke passa a depender do manifesto de curadoria no checkout; se o caminho quebrar, o teste
  unitário que lê o manifesto real falha, em vez de o check degradar em silêncio para sempre.
- `@farejo/shared` entra como devDependency de `@farejo/web`, apenas para o smoke reusar `l2Key` e
  o schema do manifesto em vez de reimplementá-los.
- O passo de browser acrescenta um Chromium ao caminho de publicação — já instalado no mesmo job
  para os testes de e2e, então sem custo de setup novo.
- ~~Quando a #101 for resolvida, nenhum ajuste é necessário: os checks continuam passando e o log
  passa a registrar o status forte.~~ Confirmado na prática, mas com uma correção de rumo: os
  checks de fato continuaram passando sozinhos, e justamente por isso foram **apertados** na
  ADR-0060. Um check que aceita a forma degradada depois que ela deixou de ser esperada não é
  tolerância, é um buraco — deixaria a #101 voltar em silêncio.
- Cada execução completa grava em produção: 5 ativações sintéticas numa loja real e uma expiração
  do cache do catálogo. É inerente a medir o caminho real do redirect — a alternativa seria uma
  rota de bypass no código de produção, pior. Fica registrado para que a métrica de ativação seja
  lida sabendo disso; o modo somente-leitura existe para todo uso que não seja a publicação.
- Validado contra a produção real em 23/07/2026 no modo somente-leitura (53 ok, 0 falhas, 3 não
  verificados) e com o smoke de browser (4 ok). Foi essa execução que expôs o viés de amostragem
  acima, que nenhum fixture local reproduzia.
