# Dado mínimo, consentimento informado e eliminação real

## Contexto

Esta é a primeira vez que o farejô trata dado pessoal. Até aqui o produto é anônimo por construção:
sem conta, sem sessão, sem cookie, sem `users`; a ADR-0017 registra que nem ativação persiste
usuário, IP ou termo pesquisado, e a única preferência do **Usuário** vive no `localStorage` dele
(ADR-0034).

Dois detalhes definem o risco de verdade:

- **O `Update` do Telegram traz muito mais que `chat.id`**: `first_name`, `last_name`, `username`,
  `language_code`, `is_premium`, o texto integral da mensagem. Um handler que persista o que recebeu
  passa a guardar nome e @ de cada pessoa sem ninguém ter decidido isso.
- **O dado mais sensível não é o `chat_id`, é a lista de lojas.** Um número de chat é um
  identificador; `chat_id` + "acompanha três lojas de apostas" revela interesse de consumo de uma
  pessoa identificável.

A ADR-0031 tirou Termos e Privacidade do MVP, mas com uma ressalva que descreve exatamente este
momento: *"não substitui uma avaliação jurídica sobre o que será necessário na publicação"* e
*"quando entrarem em escopo, conteúdo, rotas, **dados tratados pelo produto** e requisitos aplicáveis
serão revisados"*.

## Decisão

**Do update sobrevivem duas coisas: `chat.id` e o comando reconhecido.** Todo o resto é descartado
antes de qualquer escrita. A validação é uma **allowlist de campos**, nunca passthrough. O que não
existe no banco não vaza, não precisa de política de retenção e não aparece em backup — é o controle
de segurança mais forte disponível aqui, e o mais barato.

**A ADR-0031 é acionada, não revogada.** Ela previu o gatilho; a feature é o gatilho. A página de
privacidade deixa de ser pendência genérica do MVP e vira **pré-requisito bloqueante desta feature**,
sem alterar o que já está publicado.

**Base legal é consentimento, e consentimento só vale informado.** A primeira resposta do bot diz, em
duas linhas, o que é guardado (um número de chat e as lojas escolhidas), para quê, e como apagar.
Um comando `/privacidade` devolve o link a qualquer momento.

**`/parar` é `DELETE`, não flag.** Soft-delete aqui seria guardar dado pessoal de quem pediu para
sair — o oposto do que a palavra promete (LGPD art. 18, VI).

**A retenção por inatividade vem do próprio Telegram, não de heurística.** "Não interage há N meses"
é sinal ruim: quem nunca mais escreve mas quer ser avisado é o caso **normal**. Os sinais
definitivos de revogação são: update `my_chat_member` com status `kicked` (bloqueio, chega na hora),
`403 bot was blocked by the user` e `400 chat not found` (conta apagada) no envio. Qualquer um deles
**apaga as inscrições daquele chat**. É correto pela LGPD, é automático, e ainda impede envio eterno
para chats mortos.

**A transição Usuário → Assinante é deliberadamente não-observável.** O deep-link não carrega nonce
nem identificador de sessão. Um nonce permitiria medir conversão, e é exatamente o que criaria
correlação entre navegação anônima e identidade no Telegram.

**Repo público**: nenhum `chat_id` real em fixture, teste ou log. Ids de teste são sintéticos, e o
log do job registra quantidade, nunca identidade — mesmo padrão do diagnóstico de logos (F3/T16, que
registra classe de falha e não URL).

## Consequências

- Não existe funil, atribuição nem "quantos cliques no CTA viraram inscrição". Perda aceita: medir
  isso exigiria criar exatamente a correlação que a decisão evita.
- Não há como reconstruir uma inscrição apagada, nem por engano do próprio assinante. É o preço de
  `DELETE` significar `DELETE`.
- O site continua sem saber quem visita: o CTA em `/loja/[slug]` é idêntico para todo visitante e não
  pode mostrar "você já acompanha esta loja" — isso exigiria identidade no servidor e fragmentaria o
  cache compartilhado, pelo mesmo motivo que levou a ADR-0034 a pôr o toggle de correntista no
  `localStorage`.
- A tabela de inscrições é o ativo mais sensível do banco e fica sob duas roles estreitas
  (ADR-0064), nunca sob `farejo_web`, nunca sob `anon`/`authenticated` (ADR-0062).
- A publicação da feature passa a depender de um artefato **fora do código**: a página de
  privacidade. É bloqueio declarado, no mesmo formato das outras pendências operacionais.
