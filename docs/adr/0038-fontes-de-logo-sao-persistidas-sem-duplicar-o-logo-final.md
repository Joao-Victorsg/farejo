# Fontes de logo são persistidas sem duplicar o logo final

## Contexto

O contrato `RawOffer` já aceita `logoUrl` e os cinco adapters atuais extraem esse campo quando a
plataforma o fornece. Entretanto, `PreparedOfferRow` não o transporta e o pipeline o descarta antes
da escrita. O schema atual possui somente `stores.logo_url` e `stores.logo_hash`, que representam o
arquivo final publicado, e não existe persistência das fontes descobertas.

Uma loja canônica pode aparecer nas cinco plataformas. Essas imagens podem apontar para URLs
diferentes, ter formatos e qualidades distintas ou deixar de funcionar em momentos diferentes. Isso
exige múltiplas referências de origem, mas não múltiplos logos publicados.

## Decisão

Uma tabela privada `store_logo_sources` mantém no máximo uma fonte corrente por
`(store_id, platform_id)`. Ela registra a URL observada, `last_seen_at` e os metadados privados de
verificação definidos para a ingestão. Se a plataforma trocar a URL, a linha corrente é atualizada;
não se acumula histórico ilimitado de URLs.

Depois de um run aceito pelo sanity check, a escrita transacional de ofertas também faz upsert da
fonte quando `RawOffer.logoUrl` estiver presente. URL ausente não apaga uma fonte válida anterior.
Run rejeitado, soft block e item inválido não alteram a fonte.

Essa extensão apenas persiste um campo que os adapters já coletam. O caminho do scrape não baixa,
decodifica, converte nem envia imagens ao Storage. O processamento permanece separado.

O ingestor avalia as fontes do cluster canônico e publica somente um WebP final. `stores.logo_url` e
`stores.logo_hash` apontam para esse resultado. Fontes diferentes que produzam os mesmos bytes
normalizados compartilham o mesmo hash e não criam upload duplicado. Fontes não escolhidas continuam
como referências e alternativas de recuperação, não como arquivos públicos adicionais.

Após um merge de aliases, as fontes passam para a loja canônica na mesma reconciliação transacional.
A tabela não entra no Data API, no schema `web_read` nem no DTO do navegador.

## Consequências

- O processo de logos pode rodar depois do scrape sem perder os candidatos encontrados.
- Uma loja ocupa no máximo cinco pequenas linhas de origem, mas continua com um único logo público.
- Uma fonte quebrada pode ser substituída por outra plataforma sem novo trabalho de descoberta.
- A seleção de qualidade não fica acoplada ao adapter nem ao pipeline de ofertas.
- O schema e os tipos precisam distinguir claramente URL de origem privada e URL final pública.
