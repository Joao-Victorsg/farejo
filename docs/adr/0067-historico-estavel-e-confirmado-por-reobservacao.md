# Histórico estável é confirmado por reobservação

## Contexto

A ADR-0010 condicionou o gráfico a pelo menos uma mudança real. Isso evita fabricar uma série a
partir do primeiro evento, mas deixa ofertas estáveis permanentemente em “Histórico sendo
construído”: `offer_history` é delta-based e, por contrato, uma coleta idêntica não cria outra
linha.

Essa coleta idêntica ainda é uma observação real. O pipeline atualiza `offers.last_seen_at` quando
reencontra a oferta com o mesmo estado, preservando o delta no histórico e registrando que o valor
continuava vigente naquele instante.

## Decisão

Esta ADR refina exclusivamente a cláusula de suficiência da ADR-0010. Uma série pode sustentar o
gráfico quando:

- contém uma mudança real, como antes; ou
- contém ao menos um segmento não nulo e o estado atual foi reobservado depois do primeiro evento
  alcançável da série.

A confirmação usa `{ rewardType, value, observedAt }`, onde `observedAt` vem de
`offers.last_seen_at`. Ela só é válida quando:

- `observedAt` é estritamente posterior ao primeiro evento alcançável;
- a grandeza (`percent` ou `fixed`) e o valor coincidem com o último segmento;
- a modalidade confirmada é a mesma modalidade renderizada.

Para o Inter, correntista (`value`) e não correntista (`value_partial`) são confirmados
separadamente. A ausência de `value_partial` nunca confirma a série parcial e nenhuma modalidade
usa a outra como fallback.

Uma oferta inativa, expirada pela política de frescor ou ausente do DTO público não confirma série
plana. O frontend só recebe ofertas públicas elegíveis, portanto a confirmação é construída
exclusivamente a partir da oferta corrente presente no detalhe.

O texto do estado ainda insuficiente passa a ser:

> Ainda precisamos confirmar estes valores em uma nova coleta. Assim que isso acontecer, o gráfico
> aparece aqui.

## Baseline legado do Inter

Uma migration insere uma única baseline para cada oferta Inter ativa que tenha
`value_partial` atual e ainda não possua qualquer evento histórico parcial não nulo. A linha copia
`reward_type`, `value`, `value_partial` e `is_upto` da oferta e usa `offers.last_seen_at` como o
instante real observado.

A migration não reconstrói períodos anteriores e é protegida por `not exists`. A baseline continua
insuficiente imediatamente após a migration; o primeiro scrape Inter posterior atualiza
`offers.last_seen_at` e fornece a segunda confirmação.

## Invariantes preservados

- `offer_history` continua delta-based; coletas idênticas só atualizam `last_seen_at`.
- Boost, janela de dados de 60 dias, âncora, lacunas em desativação e separação entre `%` e `R$`
  permanecem inalterados.
- `pipeline_write_offers`, rotas públicas, DTOs externos, grants e fronteiras server-only não mudam.
- ADR-0010, ADR-0011, ADR-0058 e a issue #54 permanecem intactas como registros históricos.

## Consequências

- Uma série estável reobservada usa a linha plana já composta, participa da disponibilidade e
  produz resumo “manteve X”, com zero mudanças.
- Uma oferta observada apenas no run atual continua em “Histórico sendo construído”.
- Divergência de valor, grandeza ou modalidade impede a promoção e torna a inconsistência visível
  em vez de inventar continuidade.
- O legado parcial do Inter só deixa o estado insuficiente depois de uma coleta real posterior à
  baseline.
