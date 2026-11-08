# Referência de coleta do Zoom

Em 16/10/2026, o diretório do Zoom passou de aproximadamente 123 ofertas ativas
para 14–15, mantendo cerca de 188 lojas. Em 07/11, o Farejô registrava 66
rejeições consecutivas por `rule2_active_offers`, tanto no GitHub quanto na GCP.
A última atualização aceita tinha ocorrido em 16/10 às 09h (Brasília).

## Evidência

Em 07/11, o [diretório público](https://www.zoom.com.br/cupom-de-desconto/lojas)
declarou 188 lojas, o parser encontrou 188 registros e retornou 15 ofertas.
O percentual de cada uma das 15 ofertas foi conferido na página da loja.
A revisão de 27/10 também encontrou 15 ofertas em 187 lojas. A causa comercial
da redução não foi confirmada.

As três observações mais recentes antes do ajuste, registradas como suspeitas,
foram usadas como referência operacional do novo patamar:

| Run | Horário de Brasília | Origem | Lojas | Ativas |
| --- | --- | --- | ---: | ---: |
| 1621 | 06/11 15h | GitHub Actions | 188 | 14 |
| 1626 | 07/11 00h05 | GitHub Actions | 188 | 15 |
| 1633 | 07/11 09h | Cloud Run | 188 | 15 |

## Comportamento

Somente coletas completas do Zoom iniciadas a partir de 07/11/2026 às 12h
(15h UTC) usam a nova referência. Enquanto houver menos de três coletas
aceitas após essa data, a referência é 188 lojas e a média de 14, 15 e 15
ofertas ativas. Todos os limites continuam valendo. Enquanto a referência
verificada estiver em uso, qualquer erro de interpretação das ofertas ou
registro inválido no diretório bloqueia a escrita. O total declarado é
obrigatório nesse período e nas coletas seguintes do Zoom.

A partir de três coletas aceitas, o cálculo volta à média móvel de até cinco
coletas aceitas desde a data de corte. O histórico anterior é preservado, mas
fica fora do cálculo. `scrape_runs.notes.baseline` registra a fonte da referência,
a data de corte e a quantidade de coletas aceitas na janela.

## Publicação e verificação

O GitHub Actions passa a usar a mudança depois do merge. A GCP precisa receber
uma nova imagem pelo fluxo de release e apply aprovado. Após cada publicação,
conferir se a próxima coleta do Zoom gravou `status=ok`, registrou a referência
esperada e atualizou as ofertas. Uma queda posterior abaixo da nova referência
continua impedindo a escrita.
