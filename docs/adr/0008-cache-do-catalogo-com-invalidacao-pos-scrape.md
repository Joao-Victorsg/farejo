# Cache único do catálogo com invalidação após cada scrape

## Contexto

O catálogo muda somente quando uma coleta persiste novas ofertas. Tentar informar ao frontend
todos os slugs alterados aumentaria o acoplamento com o pipeline e exigiria um contrato de diff
que a escala atual não justifica. Ao mesmo tempo, depender apenas de um TTL pode manter um valor
antigo visível mesmo depois de uma coleta concluída.

## Decisão

Toda leitura derivada do catálogo usa a tag ampla `catalog`. Isso inclui cards, rankings, busca,
detalhe de loja, plataformas, estatísticas, boosts e histórico público. Páginas institucionais sem
dados do banco não dependem dessa tag.

Depois que o scrape de uma plataforma concluir com sucesso sua escrita atômica, ele envia um
sinal de invalidação para o frontend. O Next.js invalida a tag `catalog`; não há lista de slugs,
ofertas ou rotas alteradas. Um scrape que falha antes de persistir não invalida o cache.

A invalidação expira a tag imediatamente. O primeiro acesso posterior aguarda a reconstrução com
dados novos em vez de receber conteúdo antigo por stale-while-revalidate. Como as consultas são
pequenas, os scrapes ocorrem poucas vezes ao dia e cashback incorreto é pior que uma latência
isolada no primeiro acesso, a consistência prevalece nesse ponto.

No Next.js, o Route Handler usa expiração imediata da tag (`revalidateTag('catalog', {
expire: 0 })`), não o perfil `max`, que serviria o dado antigo enquanto revalida.

O cache também possui expiração temporal de aproximadamente uma hora como rede de segurança para
falha ou perda do sinal. A invalidação por evento é o caminho normal; o TTL é apenas o fallback.

O sinal pós-scrape é a única integração nova permitida com a Fase 2 nesta decisão. Ele não altera
scraping, cron, concorrência, sanity checks, Telegram ou o contrato de persistência.

## Transporte e autenticação do sinal

O sinal é um `POST` para um Route Handler interno do Next.js. O corpo canônico contém somente
`platform_id`, identificador do run e timestamp. A GitHub Action calcula HMAC-SHA-256 sobre o
timestamp e os bytes exatos do corpo usando um segredo compartilhado; envia timestamp e assinatura
em headers. A Vercel lê o corpo cru, rejeita timestamp fora de uma janela curta, recalcula a
assinatura e compara em tempo constante antes de invalidar a tag.

O segredo existe somente em GitHub Secrets e numa variável sensível server-only da Vercel. Ele não
vai no corpo, URL, logs ou bundle. O payload não é confidencial e continua protegido por HTTPS; o
HMAC prova origem e integridade, não criptografa o conteúdo.

Repetir uma assinatura válida dentro da janela não muda o resultado porque invalidar a mesma tag é
idempotente. Persistir uma lista de nonces ou runs consumidos só para impedir esse replay curto não
se justifica; timestamp, janela curta e limites do endpoint bastam para o impacto possível.

## Consequências

- Cada plataforma pode invalidar o catálogo independentemente ao terminar; múltiplas invalidações
  próximas são idempotentes.
- A próxima leitura do catálogo pode reconstruir qualquer página afetada, mas páginas não visitadas
  não são regeneradas antecipadamente.
- A invalidação ampla troca alguma recomputação desnecessária por um contrato muito mais simples e
  confiável; o volume atual torna esse custo irrelevante.
- Busca por `?q=` participa da mesma tag. Não surge `/api/search` apenas por causa do cache.
- O endpoint aceita somente `POST`, valida content type e tamanho, não usa CORS como controle de
  segurança e nunca aceita segredo em query string.
