# Ofertas expiram em degradação progressiva

## Contexto

Quando um scrape falha ou é rejeitado pelo sanity check, o estado vigente das ofertas permanece
intacto para que uma falha isolada não esvazie o site. Entretanto, `offers.active = true` não prova
que a oferta continua válida: sem uma política de frescor, uma plataforma quebrada poderia continuar
participando do ranking indefinidamente. O texto genérico “atualizado hoje” do handoff também poderia
mascarar que apenas parte das plataformas foi confirmada recentemente.

As ofertas ativas são normalmente revisitadas duas vezes ao dia. A política precisa tolerar atraso
do cron e uma falha pontual, mas priorizar a correção da comparação quando as confirmações deixam de
chegar.

## Decisão

O frescor público de cada oferta é calculado a partir de `offers.last_seen_at`:

- até 24 horas: fresca, exibida normalmente;
- acima de 24 e até 48 horas: atrasada, continua em cards, rankings e estatísticas, mas sua
  plataforma é identificada como desatualizada;
- acima de 48 horas: expirada, não participa de cards, rankings, melhores ofertas nem estatísticas
  públicas até ser confirmada novamente por uma coleta válida.

Uma oferta atrasada continua com o CTA de ativação disponível durante a janela de tolerância. A
sinalização não afirma que a taxa expirou; informa apenas que sua verificação está atrasada.

No detalhe da loja, o texto de atualização usa o menor `last_seen_at` entre as ofertas efetivamente
exibidas. Usar a confirmação mais recente seria enganoso quando outra plataforma ainda estivesse na
janela de atraso. Quando houver ofertas atrasadas, a interface identifica as plataformas afetadas em
vez de reduzir a situação a um único horário agregado.

Os limites são aplicados no read model do servidor. A expiração não altera `offers.active`, não cria
histórico falso e não interfere nas regras transacionais do scraper. Uma nova confirmação válida faz
a oferta voltar automaticamente ao estado fresco. A cache de catálogo pode postergar a mudança de
faixa por até seu TTL de segurança, atualmente cerca de uma hora.

## Consequências

- Uma falha isolada não remove imediatamente uma plataforma, preservando o último run válido.
- Duas ou mais janelas perdidas não deixam uma taxa potencialmente errada competir para sempre.
- Uma loja sem nenhuma oferta fresca ou atrasada deixa de aparecer no catálogo público, mesmo que
  ainda tenha linhas `active` expiradas no banco.
- O frontend precisa representar frescor por oferta e um resumo conservador por loja.
- O handoff visual precisa ganhar o estado “atualização atrasada”, inclusive em mobile, sem tratar
  atraso como inatividade ou cashback zero.
- Métricas agregadas usam o mesmo conjunto público; ofertas expiradas não entram em contagem, média
  ou pico.
