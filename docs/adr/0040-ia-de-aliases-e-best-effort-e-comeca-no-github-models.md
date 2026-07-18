# IA de aliases é best-effort e começa no GitHub Models

> **Atualização (18/07/2026, F3/T13/#59):** a GitHub anunciou em 16/06/2026 a retirada
> completa do GitHub Models — inclusive a API de inferência — em 30/07/2026. A decisão
> abaixo não é mais executável no primeiro provedor escolhido. O classificador foi
> implementado atrás da interface best-effort já prevista aqui (`AliasClassifier` em
> `apps/scraper/src/curation/aiClassifier.ts`), mas sem nenhum provedor conectado
> (`disabledClassifier`): heurísticas determinísticas (L3/Levenshtein) continuam
> propondo candidatos normalmente, e a escolha do próximo provedor gratuito fica para
> quando surgir uma opção viável, sem mudar o manifesto nem a regra de aprovação humana.

## Contexto

A IA pode reduzir o trabalho de revisar candidatos de alias, mas o farejô mantém custo zero e não
pode tornar uma inferência externa requisito de scraping, logos, catálogo ou curadoria determinística.
O GitHub Models oferece uma integração natural com Actions e uma cota gratuita, porém continua
sujeito a limites e mudanças de disponibilidade.

## Decisão

O primeiro provedor do classificador assistido é GitHub Models, chamado pela GitHub Action com o
`GITHUB_TOKEN` e permissão mínima `models: read`. Uso pago permanece desabilitado. Somente candidatos
novos, previamente reduzidos pelas regras determinísticas, são enviados em lote para controlar
requisições e tokens.

IA é uma etapa best-effort. Cota esgotada, indisponibilidade, resposta inválida ou rejeição do modelo
não falham o scraping, a ingestão de logos, a aplicação de decisões já aprovadas nem a leitura
pública. Os candidatos continuam visíveis no resumo da execução para revisão posterior.

Prompt, schema estruturado de entrada e saída e identificador lógico do modelo ficam versionados no
Git. A integração depende de uma pequena interface interna de classificação, não de tipos exclusivos
do GitHub Models. Provedores gratuitos adicionais poderão ser testados ou usados como alternativa no
futuro sem mudar o manifesto nem a regra de aprovação humana.

Nenhum provedor recebe credenciais do Supabase, URLs privadas de conexão, segredos ou dados além das
evidências necessárias ao candidato. A resposta nunca escreve no Supabase e nunca é interpretada
como autorização de merge.

## Consequências

- A primeira experiência de IA não exige API key pessoal nem cobrança habilitada.
- Limites do GitHub Models degradam somente a explicação e ordenação dos candidatos.
- Trocar ou adicionar modelo não altera a fonte de verdade nem o fluxo de curadoria.
- O classificador precisa validar saída estruturada e registrar qual prompt/modelo gerou cada
  proposta.
- Qualidade do modelo pode ser comparada com decisões humanas sem permitir auto-merge.
