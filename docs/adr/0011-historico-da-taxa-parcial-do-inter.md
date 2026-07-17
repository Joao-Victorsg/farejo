# Histórico da taxa parcial do Inter acompanha o toggle global

## Contexto

`offers` já guarda `value` para correntista Inter e `value_partial` para não correntista, mas
`offer_history` registra somente `value`. Sem ampliar o histórico, desligar o toggle global mudaria
cards e ranking enquanto o gráfico continuaria representando a condição de correntista.

## Decisão

`offer_history` passa a ter `value_partial` nullable. Para o Inter, o primeiro evento criado depois
da migration registra as duas taxas disponíveis, e uma mudança em qualquer uma delas cria novo
evento delta. Para as demais plataformas, `value_partial` permanece `null`.

Linhas históricas anteriores à migration continuam com `value_partial = null`. O valor parcial
atual não é copiado para timestamps passados: isso fabricaria uma série que nunca foi observada.
Quando uma oferta fica inativa, o evento de desativação usa `value = null` e
`value_partial = null`.

Na página da loja, o toggle global escolhe também a série Inter do gráfico. Se estiver desligado e
não houver observações parciais suficientes, a UI mostra “Histórico sendo construído” para essa
série em vez de reutilizar a série de correntista.

## Consequências

- A condição do Inter fica semanticamente consistente entre ranking, detalhe e histórico.
- A suficiência histórica é avaliada separadamente para `value` e `value_partial`.
- A mudança não reabre adapters ou scraping: a taxa parcial já existe no contrato e na oferta
  atual; somente persistência de histórico e leitura pública são ampliadas.
- O período anterior à migration é explicitamente desconhecido para não correntistas.
