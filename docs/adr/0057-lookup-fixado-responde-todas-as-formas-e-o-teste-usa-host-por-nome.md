# O lookup fixado devolve todos os endereços validados, e o teste de rede usa host por nome

## Contexto

A ADR-0014 e a F3/T15 fixam a conexão de download de logos no endereço já validado, via `lookup`
customizado no `connect` do `undici` — a defesa contra DNS rebinding. A implementação respondia
sempre pela forma clássica do callback do Node: `callback(null, address, family)`.

O `lookup` do Node, porém, tem **duas** formas de resposta, e quem escolhe é quem chama, não quem
implementa. Com `autoSelectFamily` — padrão desde o Node 20 — o `net.connect` chama o lookup com
`{ all: true }` e espera um **array** de `{ address, family }`. Recebendo a tripla, ele lê
`addresses[0].address` como `undefined` e aborta com `ERR_INVALID_IP_ADDRESS`, que sobe como
`TypeError: fetch failed`.

O efeito em produção foi total e silencioso: **100% dos 2182 downloads de logo falharam**, nas
cinco plataformas, classificados como `network_or_http`. Como o desenho manda falha de fonte virar
`rejection_reason` privado e fallback visual honesto, o job terminava **verde** com 0 logos
publicados e 1044 lojas no fallback — 0% de cobertura contra a meta de 95% da ADR-0043. O verde era
o desenho funcionando; nada no run dizia que a causa era um defeito nosso, e não CDNs hostis.

A suíte não pegou nada disso porque o servidor de teste era endereçado por `http://127.0.0.1:PORT`.
Com **IP literal na URL, o Node conecta direto e nunca chama o lookup**. Todos os testes de SSRF,
redirect, cap de tamanho e timeout passavam exercitando um caminho de rede que produção não usa.

## Decisão

O `lookup` fixado responde nas duas formas: array quando `opts.all`, tripla caso contrário.

`resolveValidatedAddress` vira `resolveValidatedAddresses` e devolve **todos** os endereços
validados, não só o primeiro. A validação continua tudo-ou-nada — qualquer registro não roteável
publicamente recusa a URL inteira, sem "escolher em volta" —, então o conjunto inteiro é exatamente
tão confiável quanto qualquer elemento dele, e entregá-lo completo ao `connect` deixa o Node
escolher um endereço com rota. Isso fecha de graça um segundo risco já registrado e nunca
verificado: fixar `records[0]` quebra host cujo primeiro registro é AAAA num runner sem rota IPv6 —
como o do GitHub Actions, onde este ingestor roda.

O servidor de teste passa a ser endereçado por **nome** (`logo-cdn.test`), resolvido pelo
`resolveAddress` injetado. Host por nome é invariante do harness, não detalhe: é o que faz cada
teste atravessar o `lookup` fixado de verdade. Revertendo só a implementação do lookup, 8 dos 21
testes falham — verificado.

### O defeito que estava atrás deste

Destravados os downloads, o primeiro run real subiu a cobertura de 0% para 93,8% (974/1038) e
falhou no último passo: `Catalog invalidation returned HTTP 401`. A rota valida `platform_id`
contra um enum que não incluía `"logos"` — valor que o ingestor sempre enviou, mas que só chega lá
quando ALGUMA loja troca de ponteiro. Como nenhuma trocava, o 401 nunca tinha como aparecer. O
emissor tipa `platformId` como `string`, então o compilador também não acusava. `"logos"` entra no
enum, com teste próprio.

A exceção subia de dentro de `ingestLogos`, depois de os ponteiros já estarem gravados, e levava
junto todo o diagnóstico de um run de 27 minutos — justamente as contagens por classe de rejeição
que dizem por que as lojas restantes seguem no fallback. A falha de invalidação passa a ser
registrada no resumo: o run continua terminando em erro, mas só depois de reportar o que fez. O
catálogo se corrige sozinho no TTL de ~1 h, então a invalidação perdida degrada frescor, não
correção.

## Consequências

- As garantias de SSRF ficam idênticas: só HTTPS, resolução e validação antes de conectar,
  revalidação a cada hop de redirect, cap de tamanho e timeout por hop. Nada foi afrouxado para os
  downloads passarem.
- O caminho de rede de produção passa a ser coberto pela suíte, incluindo o teste com Postgres e
  Storage reais.
- Um teste novo que use `http://127.0.0.1:PORT` reabre o ponto cego sem falhar nada. O nome do host
  no harness carrega comentário explicando por quê.
- Fica registrado o padrão de diagnóstico: neste ingestor, **job verde com cobertura zero é
  sintoma**, não sucesso. Falha uniforme em 100% das fontes e de todas as plataformas aponta para
  causa nossa, nunca para o lado dos CDNs.
