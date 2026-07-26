# Aviso dispara na transição, e a inscrição escolhe entre melhoria e acompanhamento

## Contexto

Os **Avisos** por loja são a primeira notificação proativa do farejô. A fonte natural do gatilho é o
`offer_history`, que é delta-based (`pipeline_write_offers` só insere linha quando algo mudou). A
armadilha é tratar "existe linha nova" como "o cashback melhorou": das cinco formas de nascer uma
linha, três não são melhoria nenhuma.

| Caso | O que grava | É melhoria? |
|---|---|---|
| Inter muda só o não-correntista (1% → 1,5%), correntista fica em 3% | linha nova (ADR-0011) | não |
| Loja some e volta com o mesmo valor (`no_cashback` → `offer`) | `value=null`, depois `value=3` | não |
| `R$ 10` vira `5%` | linha nova | não — os tipos nunca se comparam |
| `5%` vira `até 10%` | linha nova | **sim** |
| Loja assinada ganha uma plataforma nova | primeira linha do par | sim |

A assimetria decide os casos duvidosos, e é a mesma da curadoria de aliases (ADR-0006): um **Aviso
falso** interrompe a pessoa com uma informação que ela confere e desmente, e o custo é ela bloquear
o bot — irreversível. Um **Aviso perdido** só não avisou. Não há simetria, então o desempate é
sempre conservador.

## Decisão

**Gatilho.** Uma **Melhoria** é uma linha de `offer_history` cujo `value` é estritamente maior que o
**último valor não-nulo** do mesmo par (loja, plataforma), com o mesmo `reward_type` nas duas
pontas. Sem nenhum valor não-nulo anterior, é oferta nova e também é Melhoria.

Usar o último valor **não-nulo** como baseline — e não a linha imediatamente anterior — faz as
linhas de desativação ficarem **invisíveis** para os Avisos. Queda e saída de linha deixam de
precisar de regra própria: elas simplesmente nunca satisfazem "estritamente maior".

**`is_upto` não participa da comparação.** `5%` → `até 10%` é Melhoria. O ranking público já ordena
*up-to* pelo valor nominal (`CONTEXT.md`, "up-to"); uma definição de "maior" diferente no motor de
Avisos criaria duas noções de maior cashback no mesmo produto. Em contrapartida, **o Aviso é
obrigado a mostrar a natureza dos dois lados** ("Méliuz: 10% → **até** 12%"). Sem isso a mensagem
afirmaria aumento onde o piso garantido caiu.

**Dois modos por inscrição.**

- **Modo melhoria** (padrão do `/start`): avisa em toda Melhoria. Quedas e fim de oferta são
  silenciosos.
- **Modo acompanhamento**: tem um **Piso** X, tipado como Reward, e avisa em **qualquer** mudança de
  valor que aterrisse **em X ou acima** — subindo ou descendo. Piso em `percent` só observa ofertas
  percentuais; piso em `fixed`, só as em reais.

A comparação é **inclusiva** (`>= X`), precisão feita na implementação (#114): piso é chão, e uma
oferta que marca exatamente X está nele, não abaixo dele. Excluir a borda faria quem pediu "a partir
de 10%" não ser avisado justamente em 10%, e o sintoma seria a ausência de mensagem — o pior modo de
falha desta feature.

A saída da região do piso — inclusive por fim da oferta — é **silenciosa**, por consequência da
regra: nenhum valor abaixo de X, e nenhuma desativação (`value = null`), a satisfaz. Foi uma escolha
deliberada, não um esquecimento (ver Consequências).

**Um Aviso por (assinante, run).** A mensagem reúne todas as Melhorias daquele run em todas as
inscrições da pessoa, agrupadas por loja e, dentro da loja, por plataforma. Não é uma mensagem por
melhoria nem por loja: no dia em que uma plataforma sobe centenas de lojas de uma vez, o modelo
por-melhoria vira rajada contra o limite de 1 msg/s por chat do Telegram.

**Estado é um cursor, não um valor.** Oscilação sempre avisa (12 → 14 hoje, 14 → 12 amanhã, 12 → 14
depois: três Avisos), então não existe "último valor avisado". O que precisa ser evitado é
reprocessar a **mesma** transição. `offer_history.id` é `bigint generated always as identity`, então
o cursor é ele — **um por assinante**, porque avançar depende de o envio àquele chat ter dado certo.
O job processa `id > cursor` do assinante, envia, e **só avança o cursor se o envio deu certo** —
falha do Telegram vira lote acumulado no run seguinte, nunca Aviso perdido. Inscrição nova não
desenterra passado: além do cursor, filtra `changed_at >= inscrição.created_at`.

**A inscrição atravessa o merge de alias.** `curation.apply_alias_merge` termina em
`delete from stores`, e trata explicitamente cada tabela que referencia `stores` — o comentário da
própria migration registra que pular `activation_metrics` "quebra o DELETE das lojas absorvidas
assim que houver alguma ativação real". A tabela de inscrições entra na mesma lista, com
upsert-then-delete no padrão de `store_logo_sources`. **Sem `on delete cascade`**: cascade apagaria
a inscrição em silêncio e a pessoa nunca saberia que parou de ser avisada. Colisão (o assinante
tinha inscrição na absorvida **e** na canônica) resolve pela **mais recente** por `created_at`; no
empate exato sobrevive a da **canônica**, porque empate não tem "mais recente" e o que se exige da
regra é ser determinística e declarada, não justa.

## Consequências

- **O soft-block já está fechado na origem, sem defesa nova.** `apps/scraper/src/pipeline/run.ts`
  exclui `soft_block` dos outcomes e do escopo, então a loja não é desativada e nenhuma linha de
  histórico é escrita. Nas três plataformas full-scope o soft-block seria de request inteiro e
  derruba o sanity check antes de qualquer escrita. Os Avisos herdam essa proteção de graça.
- **Mudança só em `value_partial` nunca avisa.** O toggle de correntista continua sendo escolha de
  leitura; o gatilho olha só `value`, coerente com a ADR-0020/ADR-0045.
- **`até 5%` → `5%` garantido não avisa.** É melhoria real de garantia sem aumento nominal, perdida
  de propósito pelo lado conservador da assimetria.
- **Quem usa piso nunca é avisado de que a oferta caiu abaixo dele ou acabou.** O último Aviso
  recebido pode ficar desatualizado por tempo indefinido. Aceito explicitamente: a queda pequena
  dentro da região avisa e a saída não, o que é assimétrico, mas evita transformar o bot em
  mensageiro de más notícias.
- **Toda tabela nova que referencie `stores` precisa entrar em `apply_alias_merge`.** Esquecer não
  falha em silêncio: quebra o `curation-apply.yml` inteiro com violação de FK no primeiro merge que
  encostar numa loja assinada.
- **O cursor só pode ser lido quando NÃO há escrita de histórico em voo, e essa é uma pré-condição
  do desenho, não uma otimização.** Os 7 jobs de scrape rodam em paralelo (`scrape.yml`, cada um com
  seu `concurrency`, sem `needs` entre eles), e o `id` de `offer_history` vem de uma sequence:
  `nextval` **não é transacional**. Uma transação pode reservar o id 100, outra reservar o 101 e
  commitar primeiro. Um cursor baseado em id que seja lido nesse intervalo enxerga 101 como marca
  d'água, e o 100 — quando commitar — já nasce abaixo dela.

  A perda daí é **permanente, não transitória**: o cursor de todos os assinantes já passou do ponto,
  inclusive o de quem não recebeu nada naquele run (que também avança, para a janela de varredura
  não crescer sem fim). Nenhum run seguinte volta a olhar aquela linha.

  Não há watermark seguro possível enquanto houver escritor concorrente — o problema é da sequence,
  não da consulta. A defesa é operacional e só existe se o workflow a garantir: o job espelha o
  `logos.yml` (`workflow_run` + `conclusion == 'success'`), quando as 7 transações já commitaram.
  Um scrape manual sobreposto ao job de Avisos quebra a pré-condição e perde a transição em
  silêncio; fechar isso com um guard explícito (recusar rodar enquanto houver `scrape_runs` sem
  `finished_at`) é trabalho do ticket do workflow, e está registrado lá.
