# A janela do histórico é derivada do dado e o período é escolhível

## Contexto

A ADR-0010 fixou uma janela de 60 dias para o histórico da loja. Isso é o contrato de leitura, e
continua correto. Mas a apresentação herdou o mesmo número como domínio do eixo, e essa parte não
sobreviveu ao contato com dados reais.

Medição em `/loja/cea` (21/07/2026): a loja tem 16 eventos, todos entre 14/07 e 21/07 — **7 dias de
dado desenhados num eixo de 60**. Na área de plotagem medida no desktop (712 px), o histórico
inteiro ocupava 98 px, 12% da largura, com as 14 mudanças a ~7 px uma da outra. O marcador de
mudança tem 7 px de diâmetro: os pontos literalmente se encostavam, e 88% do gráfico era grade
vazia. Não é densidade de informação — é escala.

O problema é permanente, não só de lançamento: toda loja nova nasce assim, e uma loja que muda de
cashback várias vezes por dia continua ilegível em 60 dias mesmo quando tiver 60 dias.

## Decisão

Separam-se três janelas que antes eram o mesmo número:

- **Janela de dados** — 60 dias, inalterada. `web_read.store_history`, a âncora anterior à janela e
  o `composeStoreHistory` continuam exatamente como a ADR-0010 definiu.
- **Janela de sinal** — inalterada. `deriveOfferSignals` (ADR-0012/0013) segue lendo os 60 dias com
  mínimo de 30 dias ativos. Trocar o período exibido **não** altera o badge BOOST nem o valor típico.
- **Janela renderizada** — derivada do dado e escolhível pelo leitor, sempre dentro dos 60 dias
  servidos.

A régua de períodos é **derivada da loja**, nunca uma lista fixa: um degrau maior que o dado
reproduziria o eixo vazio que esta decisão resolve. Um degrau só entra se encurtar a janela em pelo
menos um quarto — degraus separados por horas seriam escolha falsa. Quando sobra uma opção só, o
seletor não é renderizado.

O último degrau só se chama **"Tudo"** quando a série não alcança o início da janela servida. Numa
loja mais velha que 60 dias, o teto se chama "60 dias": 60 é tudo o que lemos, não tudo o que a
loja viveu. A mesma distinção entre "não existe" e "não vimos" que governa `soft_block` e lacuna.

O **padrão** é escolhido por densidade de mudanças, não por volume de dias: a maior opção em que o
espaçamento médio entre degraus fica acima do piso de legibilidade, medido numa largura de
referência fixa. A largura é fixa de propósito — um padrão derivado do viewport real divergiria
entre servidor e cliente e pularia no primeiro paint.

A escolha vive na URL (`?periodo=`), como a ordenação do catálogo, mas é lida e escrita no cliente:
os 60 dias já estão no payload, então recortar não custa rede. Um `?periodo=` que a loja não pode
honrar cai no padrão calculado em vez de virar janela vazia.

A escala vertical é **recalculada** por período: quem aproxima quer ver a variação daquele
recorte, e os rótulos do eixo desfazem a ambiguidade de altura. A janela é **compartilhada** entre
os cards de percentual e de valor fixo — eixos de tempo diferentes pareceriam comparáveis sem ser.

Recortar um período onde nada mudou **não** volta a "Histórico sendo construído": a loja tem
mudanças observadas, e uma linha reta ancorada é histórico verdadeiro.

## Consequências

- O texto do resumo e o equivalente em `sr-only` passam a acompanhar o período exibido; "todo o
  histórico disponível" e "os últimos N dias" são frases diferentes porque são fatos diferentes.
- Ticks do eixo passam a ser escolhidos pelo vão da janela: marcas diárias numa janela de 8 dias,
  semanais numa de 60.
- A legenda passa a seguir a ordem do ranking (`rankOffers`) em vez de ordem alfabética. Como o
  padrão de traço é indexado pela posição, a plataforma que paga mais recebe o traço contínuo.
- `6 meses`, `1 ano` e `Tudo` numa loja madura ficam **fora** desta decisão: exigiriam ampliar o
  contrato de leitura, e o custo é real — na cadência medida no C&A, ~800 eventos/ano por loja no
  payload de toda visita. Pede decisão própria sobre downsampling ou agregação no servidor, e a
  agregação traz seu próprio risco de inventar um valor que nunca existiu num dia específico.
- Baselines visuais do detalhe da loja precisam ser regeradas: o seletor passa a existir e o eixo
  muda de escala.
