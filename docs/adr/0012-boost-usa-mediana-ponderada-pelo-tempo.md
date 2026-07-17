# Boost usa mediana ponderada pelo tempo

## Contexto

Boost já está definido como valor atual significativamente acima do típico: janela de 60 dias e
limiar `atual >= típico × 1,3`. O histórico, porém, é delta-based e só grava uma linha quando algo
muda. Calcular a mediana diretamente sobre essas linhas daria o mesmo peso a um valor vigente por
semanas e a outro que durou poucas horas.

## Decisão

O valor típico é a mediana ponderada pela duração dos intervalos da série em degraus durante os
últimos 60 dias. Cada valor pesa pelo tempo real em que permaneceu vigente, delimitado pelo evento
seguinte ou pelo instante da leitura.

A consulta inclui o último evento anterior ao início da janela para reconstruir o primeiro
intervalo. Períodos inativos (`value = null`) não viram zero e não participam da distribuição de
valores. Percentuais e valores fixos são calculados separadamente; eventos de outro `reward_type`
não entram na mediana do tipo atual.

O limiar continua exatamente `valor atual >= mediana ponderada × 1,3`. O boost permanece derivado
na leitura e nunca é persistido como flag.

A baseline só é considerada suficiente quando existem pelo menos 30 dias de oferta ativa
observada dentro da janela de 60 dias. Os dias podem estar em intervalos separados, mas períodos
inativos não contam. Abaixo desse mínimo, o resultado é `histórico insuficiente` e nenhum selo de
boost é exibido, ainda que a razão matemática pudesse ser calculada sobre poucos pontos.

Para o Inter, `value` e `value_partial` produzem medianas independentes. O toggle global seleciona
tanto o valor atual quanto a baseline correspondente; uma série não serve de fallback para a
outra.

## Consequências

- Uma promoção curta não distorce a baseline como se tivesse durado o mesmo que a taxa normal.
- Desativação não transforma reativação comum em boost contra uma baseline artificial de zero.
- A leitura pública precisa reconstruir intervalos, não apenas aplicar `percentile_cont` às linhas
  brutas de `offer_history`.
- Lojas novas e séries parciais precisam acumular 30 dias ativos antes de receber selo de boost.
