# Valor anterior não define boost e validade não é inferida

## Contexto

As plataformas podem expor um texto nativo como “era 2%”, enquanto a aplicação também consegue
observar o intervalo anterior em `offer_history`. Nenhuma das fontes atuais oferece uma data de fim
confiável. Esses dados complementam a apresentação, mas não podem substituir a regra histórica de
detecção do boost.

## Decisão

Uma oferta só recebe selo de boost quando satisfaz a baseline da janela de 60 dias, a cobertura
mínima de 30 dias ativos e o fator `1,3`. Um valor anterior nativo nunca contorna histórico
insuficiente nem cria boost sozinho.

Para uma oferta que já qualificou como boost, o texto de valor anterior segue esta precedência:

1. valor anterior nativo fornecido pela própria plataforma, se for válido e do mesmo
   `reward_type` atual;
2. na ausência dele, valor do intervalo histórico imediatamente anterior, somente se esse
   intervalo estava ativo e tinha o mesmo `reward_type`.

A mediana ponderada nunca é rotulada como “valor anterior”: ela é o típico estatístico e pode não
ter sido a taxa imediatamente anterior. Uma inatividade entre dois valores também impede usar o
valor ativo antigo como se a transição tivesse sido contínua.

O dado nativo precisa ser persistido como snapshot atual, incluindo valor parseado e texto cru para
auditoria. Cada scrape bem-sucedido o atualiza ou limpa quando a fonte deixa de fornecê-lo; um valor
nativo ausente não pode permanecer obsoleto em `offers`.

Validade só aparece se uma plataforma fornecer uma data final explícita e verificável. Não se
infere validade pelo próximo scrape, frequência do cron, duração histórica de boosts ou texto vago.
Como nenhuma fonte atual oferece essa data com segurança, a primeira entrega não mostra validade.

## Consequências

- `previousRewardText`, hoje extraído mas descartado antes do banco, passa a ter persistência
  operacional na Fase 3.
- O contrato público diferencia `isBoost`, `typicalValue`, `previousValue` e `validUntil`; os dois
  últimos são nullable e nunca recebem valores sintéticos.
- `validUntil` permanece ausente/null na primeira entrega, sem coluna operacional ociosa enquanto
  não existir uma fonte real.
- Mudança de `%` para `R$`, ou o inverso, quebra a relação de “era”; os tipos não se comparam.
