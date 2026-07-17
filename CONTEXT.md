# farejô

Comparador de cashback: dada uma loja, mostra qual **plataforma** devolve mais, com link de redirecionamento. Este documento é o glossário da linguagem ubíqua do projeto — não é spec nem registro de decisões.

## Language

### Entidades

**Plataforma**:
Um dos cinco serviços de cashback comparados (Méliuz, Cuponomia, MyCashback, Zoom, Shopping Inter). No código: tabela `platforms`, FK `platform_id`, tipo `Platform`. Na UI e nas rotas: "plataforma", `/plataformas` (handoff).
_Avoid_: portal, site (este último é a *propriedade web que raspamos* — ver "site alvo" —, não a entidade).

**Loja canônica**:
A entidade única que o usuário vê e busca; agrega as aparições da mesma loja em várias plataformas. Chave de normalização é a L2 (ver POC), que **é** o `stores.slug`.
_Avoid_: merchant, seller, retailer (são termos crus das plataformas).

**Oferta**:
O cashback vigente de uma **loja canônica** numa **plataforma** específica (1 por par loja+plataforma).
_Avoid_: deal, promo.

**Alias**:
Mapa de um nome cru de loja numa plataforma → **loja canônica**. Memória permanente e curada.

### Cashback

**Reward**:
O valor de uma oferta, de um de dois tipos que **nunca se comparam entre si**: `percent` (%) ou `fixed` (R$). Percentual sempre ordena antes de fixo.

**up-to** ("até X%"):
Reward percentual que é um teto, não uma promessa (`is_upto=true`). Ordena pelo valor, mas a UI sinaliza que é teto.

**Boost**:
Oferta cujo valor atual está significativamente acima do típico. Derivado na leitura (mediana dos
intervalos dos últimos 60 dias, ponderada pela duração, × 1,3), nunca persistido como flag. A
plataforma às vezes expõe o valor anterior nativamente ("era 2%").

**Correntista**:
Cliente do Banco Inter. O Inter paga cashback maior a correntista (`value`) do que a não-correntista (`value_partial`). Só o Inter tem essa distinção.

### Catálogo público

**Oferta pública elegível**:
Oferta ativa que ainda está dentro da política de **frescor** e pode participar de catálogo, busca,
ranking, agregados e ativação. Entre 24 h e 48 h continua elegível, mas aparece como atrasada; acima
de 48 h deixa de ser pública.

**Frescor**:
Idade da última verificação conclusiva de uma oferta. Até 24 h é normal; de 24 h a 48 h é
**atualização atrasada**; acima de 48 h a oferta expira das superfícies públicas. Não confundir com
validade promocional informada pela plataforma.

**Catálogo**:
Conjunto de todas as **lojas canônicas** com ao menos uma **oferta pública elegível**. Não é uma
seleção de lojas populares. A ordem padrão privilegia **cobertura de plataformas** e o catálogo é
paginado em 24 lojas.

**Cobertura de plataformas**:
Quantidade de plataformas distintas com oferta pública elegível para uma loja canônica. É o sinal
da ordenação padrão “Mais plataformas”; não significa popularidade.

**Maior cashback**:
Ordenação opcional de lojas. Lojas com alguma oferta percentual vêm antes das lojas exclusivamente
fixas. Percentuais ordenam entre si; valores em reais ordenam entre si. A referência Inter é sempre a
taxa de correntista para que o toggle não mova lojas.

**Ativação**:
Clique em “Ativar” validado pelo servidor antes de redirecionar à URL vigente da plataforma. Não é o
pagamento do cashback e não torna o farejô intermediário da compra.

**Histórico sendo construído**:
Estado público de uma loja sem mudança real suficiente nos últimos 60 dias para sustentar um gráfico.
Não é erro, série vazia nem autorização para fabricar pontos.

**Loja indisponível**:
Loja canônica válida, mas sem oferta pública elegível naquele momento. Sua rota continua existindo,
sem CTA, para não confundir indisponibilidade temporária com slug inexistente.

### Curadoria e logos

**Candidato de alias**:
Hipótese de que dois nomes representam a mesma loja canônica. Pode ser gerada por regra, trigram ou
IA, mas nunca altera o catálogo automaticamente.

**Decisão de alias**:
`merge` ou `reject` aprovada por revisão humana no manifesto versionado no Git. Só o merge do PR
autoriza a materialização no Supabase.

**Fonte de logo**:
URL de imagem observada numa plataforma e mantida como dado operacional privado. Uma loja pode ter
até uma fonte corrente por plataforma.

**Logo final**:
Único WebP público escolhido para a loja canônica e hospedado no Supabase Storage. Não confundir com
as múltiplas fontes privadas nem com os ícones fixos das plataformas.

### Coleta e integridade

**Adapter**:
Módulo isolado por plataforma que **só extrai** dados crus (`RawOffer`), nunca interpreta. Parsing, normalização e decisão de ativo/inativo vivem no pipeline compartilhado.

**Oferta crua** (`RawOffer`):
A extração literal de uma oferta como a **plataforma** a exibe, antes de qualquer interpretação. É a **camada anticorrupção** entre uma plataforma e o domínio: o domínio compartilhado nunca conhece uma plataforma específica — só conhece **Oferta crua**. Cada adapter traduz o shape próprio da sua plataforma para `RawOffer`; de `RawOffer` para dentro, a plataforma deixa de existir.

**Site alvo**:
A *propriedade web* que um adapter raspa (seu HTML, seu anti-bot, o **total declarado** que ela publica). Distinto de **Plataforma** (a entidade): "o HTML servido pelo site mente" fala do site alvo; "a oferta desta plataforma" fala da entidade.

**Varredura completa** (full-sweep):
Coleta em que um run cobre o universo inteiro de lojas da plataforma (inter e mycashback: 1 request). Oposto de **coleta tiered**.

**Coleta tiered**:
Coleta em que um run cobre só uma fatia (tier) da plataforma — tier ativo com frequência alta, cauda com frequência baixa e fatiada (cuponomia, méliuz; fases futuras).

**Escopo do run** (run scope):
O conjunto de lojas pelas quais um run se responsabiliza. Numa **varredura completa** é a plataforma inteira; numa **coleta tiered** é só a fatia visitada. Só se pode **desativar por ausência** o que estava no escopo.

**Desativação por ausência**:
Regra de que uma oferta some da plataforma ⇒ vira inativa (`active=false`), nunca deletada; se reaparecer, reativa. Aplica-se apenas dentro do **escopo do run**.

**Oferta ativa**:
Oferta com cashback vigente. Métrica vigiada nos sanity checks: um **soft-block** derruba ofertas ativas **sem** mudar o total de lojas.

**Sinal de presença**:
Marcador no HTML que prova que a página pedida é a que voltou (`.store_header` no cuponomia, `.hero-sec` no méliuz). Ausência = erro retentável, nunca "loja sem cashback".

**Soft-block**:
Bloqueio por taxa que devolve HTTP 200 com a home (não 429/403). Não some com a loja: transforma ativa em inativa em silêncio.

**Oferta fantasma**:
Oferta emitida por engano a partir de um marcador de "sem cashback" tratado como valor (ex.: mycashback `"Sem  Cashback"`). Bug de adapter, não oferta real.

**Desfecho real**:
Resultado conclusivo da coleta de uma loja: `offer` | `no_cashback` | `not_found`. Um **soft-block** **não** é desfecho real — é anomalia retentável. Só desfecho real conta como "loja processada" e entra no `rawCount`.

**Desfecho por slug**:
O relato, loja a loja, de qual **desfecho real** aconteceu (ou `soft_block`) — usado para sincronizar o **tier de coleta** na mesma escrita da oferta. Existe em qualquer **site alvo** com `crawl_state` (cuponomia, méliuz), **independente** do **escopo do run** ser `full` ou `partial`: até a varredura de bootstrap reporta por slug.

**Tier de coleta**:
Classificação de uma loja dentro de uma **coleta tiered**: `active` (checada com alta frequência) ou `tail` (baixa frequência, fatiada). Muda por **desfecho real**: `offer` promove a `active`; `no_cashback`/`not_found` demove a `tail`. `soft_block` **nunca** muda o tier nem o horário da última checagem — o slug segue vencido. Sem histerese (muda no primeiro desfecho oposto, não exige confirmação dupla) e sem estado adicional para `not_found` repetido — ambos adiados de propósito (YAGNI) até haver sinal real de oscilação ou de lojas mortas persistentes.

**rawCount**:
Quantos itens um run recebeu com **desfecho real**, medido **antes** de filtrar inativas. É o número comparado ao **total declarado** na regra 4 do sanity check — nunca a contagem de **ofertas ativas** (que já excluiu as inativas).

**Total declarado** (declaredTotal):
Contagem de máquina, autoritativa, que a própria plataforma publica sobre si (`pagination.total` no inter; `"N lojas encontradas"` no zoom). Existe só em algumas plataformas; onde o "total" vem de um diretório não-autoritativo (cuponomia, méliuz), não há total declarado.

**Sanity check**:
Regra que barra a gravação de um run cujos números destoam (queda de ofertas/ativas, excesso de parse errors, **total declarado** ≠ **rawCount**). Run barrado = `suspicious`, dados do run anterior seguem servindo.

## Relationships

- Uma **Loja canônica** tem 0..N **Ofertas** (uma por **Plataforma**).
- Um **Alias** aponta um nome cru (por **Plataforma**) para exatamente uma **Loja canônica**.
- Uma **Oferta** tem exatamente um **Reward** (`percent` ou `fixed`).
- O **Catálogo** contém somente **Lojas canônicas** com ao menos uma **Oferta pública elegível**.
- Uma **Loja canônica** pode ter várias **Fontes de logo**, mas no máximo um **Logo final** público.
- Um **Candidato de alias** só muda identidade depois de virar **Decisão de alias** aprovada.
- Um run de uma **Plataforma** tem um **Escopo do run** (`full` ou parcial) que delimita a **desativação por ausência**.
- Só ~42% das lojas existem em ≥2 **Plataformas** — "uma plataforma só" é caso normal, não erro.

## Flagged ambiguities

- "site"/"portal" eram usados para a entidade de cashback — resolvido: a entidade é **Plataforma**; "site" fica só para **site alvo** (a propriedade web raspada); "portal" é _avoid_.
- "loja" era usada para o nome cru numa plataforma e para a entidade única — resolvido: nome cru vira **Alias**; a entidade é **Loja canônica**.
- `partialCashbackValue` do Inter **não** é "até" — é o tier **não-correntista** (`value_partial`).
- “Popular” **não** é sinônimo de **cobertura de plataformas**. Popularidade é um sinal futuro,
  separado, que poderá usar ativações agregadas.
- “Maior cashback” **não** compara `%` com `R$`; apenas prioriza o grupo percentual e ordena cada
  grandeza dentro do próprio grupo.
- “O toggle reordena” significa reordenar **ofertas dentro da loja**, nunca lojas no catálogo.

## Example dialogue

> **Dev:** "Se o run do cuponomia visita só o tier ativo, e a Nike não apareceu, desativo a oferta dela?"
> **Domínio:** "Só se a Nike estava no **escopo do run**. Numa **coleta tiered** você não viu a cauda — ausência lá não é **desativação por ausência**, é 'não olhei'. Já numa **varredura completa**, ausência é desativação."
