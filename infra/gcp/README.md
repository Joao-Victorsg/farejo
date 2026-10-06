# Publicação do scraper Farejo no Google Cloud

Contrato: [ADR-0070](../../docs/adr/0070-publicacao-do-scraper-no-cloud-run-por-terraform-e-oidc.md).
O piloto existente continua em `southamerica-east1`, às **09h America/Sao_Paulo**, `all/active`. Os dois agendamentos do Supabase permanecem como operação principal.

## Responsabilidades

| Diretório | Recursos | Quem aplica |
| --- | --- | --- |
| `infra/gcp` | APIs, registry, secrets sem valores, orçamento, IAM/WIF e buckets | Administrador local, após revisão e aprovação |
| `infra/gcp/runtime` | Job e Scheduler existentes | GitHub atualiza Job aprovado; Scheduler fixo, alteração só administrativa |

Atualizar o digest/configuração pelo `terraform apply` já publica a próxima execução. O workflow verifica a configuração e termina; não inicia nem acompanha coletas.

Requisitos: Terraform **1.16.5**, Google provider **7.46.1** (lockfiles versionados), Google Cloud CLI, GitHub CLI, Docker e Node 24. Não atualizar providers implicitamente durante release. Credenciais pessoais locais somente no bootstrap. As automações usam OIDC, sem chave JSON, PAT novo ou segredo GCP no GitHub.

## Bootstrap do piloto existente

1. Confirme projeto `farejo-510021`, região, faturamento e state local corretos. Copie `terraform.tfvars.example` para o arquivo ignorado `terraform.tfvars`; orçamento BRL **5,20**, equivalente aproximado ao alerta solicitado de US$ 1. Ele notifica, não limita gastos.
2. Faça backup privado do state e execute `node scripts/gcp/split-state.mjs` **uma única vez**. O script move somente Job/Scheduler para o state runtime, preserva a lineage administrativa e confere a quantidade de recursos. Neste checkout a separação já foi realizada. Nunca repetir nem aplicar um state vazio por engano.
3. A remoção do binding Editor da conta Compute padrão usa o bloco `removed`. O binding precisa estar no state administrativo antes do plano; neste checkout já foi importado. A remoção não apaga a conta. Confirme dependências antes de aprovar.
4. Gere um plano administrativo salvo. O bootstrap esperado cria WIF/IAM/buckets, altera o registry para tags mutáveis e limpeza em dry run, e remove apenas o binding Editor identificado. **Não altera Job/Scheduler.** Não publique state, plano binário ou JSON completo em artifacts, PR ou logs.
5. Obtenha aprovação humana para o plano concreto e aplique **exatamente o arquivo salvo**. O GitHub não administra essa infraestrutura de segurança.
6. Execute `node scripts/gcp/protect-images.mjs`: resolve a imagem realmente configurada e grava/verifica os dois pins iniciais. Mantenha cleanup em dry run até a primeira preparação provar push de tag nova e negar substituição via API e Docker. Publisher usa role customizada sem `tags.update`; se falhar, não conceder writer ampla para contornar. Só então revise/aprove separadamente `artifact_cleanup_dry_run=false`. Tags mutáveis permitem limpeza; Job usa digest após o primeiro release.
7. Com os buckets criados, use `node scripts/gcp/migrate-backend.mjs --approved-bootstrap`. Informe `TERRAFORM_BINARY` se o executável 1.16.5 não for padrão. O script faz novo backup privado, migra ambos os states e compara lineage/recursos. Prefixos: `bootstrap` e `scraper-prod`. Não apagar backups antes de confirmar objetos remotos e novo plan sem recriações.
8. Exporte privadamente `terraform output -json github_variables` e passe o arquivo a `node scripts/gcp/configure-github.mjs ARQUIVO`. São **10 variables sem segredo**: projeto, região, dois buckets, provider e service account para cada identidade. Nunca copiar valores dos quatro secrets para esse arquivo.
9. Execute `node scripts/gcp/configure-repository.mjs` para preparar o snapshot/proposta privados; confira e execute novamente com `--apply`. Limita Actions aos fornecedores usados, desliga aprovação de PR pelo token automático e protege `master` com o check `test`. Preserva outras proteções existentes. A proteção exige plano GitHub compatível caso o repo vire privado; confirmar antes de mudar a visibilidade. Exigência global de SHA somente após os workflows fixados estarem em `master`.
10. Publique o PR, confirme CI e faça o merge aprovado. OIDC rejeita branches de desenvolvimento; validação da autenticação federada acontece com os workflows em `master`. IAM pode levar alguns minutos para propagar. Não criar chaves para contornar falha: conferir condição do provider, claims e binding.

Após merge, execute `configure-repository.mjs --apply --require-sha`: o script verifica os workflows de `master` antes de exigir SHA globalmente. Os prepares deixam tags `permission-probe-*`, sem nova imagem; podem ser limpas administrativamente depois da validação, preservando pins. Não habilitar limpeza automática sem comprovar as negações.

## Release normal

1. CI mantém testes, build/typecheck, políticas de release e validação Terraform. PRs e forks não recebem identidade GCP.
2. Em push aprovado em `master`, `Prepare scraper release` identifica mudanças desde o último apply/verificação concluído. Constrói uma imagem uma vez e testa seu comando normal com cinco fixtures, Supabase local e invalidação HMAC. O job de teste não tem `id-token: write`. Segundo job verifica artifact e publica a imagem testada, depois testa negação de substituição em uma tag descartável. Nunca usa pins de produção como alvo negativo.
3. `Plan scraper release` salva plano/manifest em GCS privado e publica somente resumo com commit, digest, ações e **release ID**. Nenhum state/plano vira artifact do GitHub. Plano válido por 24h.
4. Revise o resumo e execute `Deploy scraper production` em `master`, release ID e `approve=true`. Somente actor ID `54454575` obtém a identidade deployer. Reruns, forks, branches, commit antigo, plano alterado ou config fora do contrato são rejeitados.
5. Confere hash/generation, CI/commit, baseline e novo plano equivalente, protege imagem anterior/atual, aplica plano salvo e verifica digest, labels, identidade e horário. Plano/deploy compartilham exclusão mútua; backend GCS também tem lock. Não acompanha execução nessa pipeline.

## Secrets e limites

Quatro secrets existentes continuam no Secret Manager, versão `1`; valores nunca entram no Terraform. Apenas `farejo-scraper-runner` lê valores. Publisher cria imagens/tags no registry; planner lê configuração/state e escreve novos planos; deployer atualiza somente Job designado, tem `actAs` apenas na conta runner e acessa prefixo runtime do state. Scheduler tem apenas leitura `jobs.get` em escopo de projeto, sem listagem, disparo ou alteração; qualquer diff nele exige administrador e novo plano aprovado fora do CI. Não modifica WIF, IAM, orçamento, valores dos secrets ou apaga imagens.

| Secret Manager | Variável runtime |
| --- | --- |
| `farejo-scraper-supabase-url` | `SUPABASE_URL` |
| `farejo-scraper-supabase-service-role-key` | `SUPABASE_SERVICE_ROLE_KEY` |
| `farejo-scraper-catalog-invalidation-url` | `CATALOG_INVALIDATION_URL` |
| `farejo-scraper-catalog-invalidation-secret` | `CATALOG_INVALIDATION_SECRET` |

Supabase `service_role` continua ampla no runtime; role específica requer trabalho separado de grants/compatibilidade. Exclusão mútua desta entrega cobre publicações, não todos os scrapes manuais. Administrador do Job ou state continua autoridade de produção.

## Recuperação

- Falha no prepare/plan: produção permanece vigente; corrija e gere candidato/plano novo.
- Falha no apply/verificação: compare state, Job, Scheduler e pins. Não repetir release cegamente nem remover lock sem confirmar ausência de aplicação em andamento.
- Rollback normal: revert em PR, CI, novo candidato/plano e aprovação. Pins preservam digest anterior para recuperação urgente; apply manual também exige plano revisto/aprovado. Não reutilizar plano consumido.
- Pausa emergencial: administrador pausa `farejo-scrape-0900-brt` no Scheduler. É alteração de produção/drift; pipeline normal rejeita config pausada. Reconciliar antes de retomar releases. Não alterar Supabase Cron.
- Antes de coleta manual, confira execuções em andamento e horários das demais coletas. Release não faz essa chamada.
- Recuperar state exige backup da versão vigente e revisão de lineage/serial. Nunca usar `destroy` para resolver migração.

## Custos adicionais

WIF/IAM não têm cobrança própria. Buckets Standard em `us-east1` usam franquia de armazenamento/operações disponível na conta; planos expiram em 7 dias, manifests em 90. State tem versionamento, soft delete e retenção das 10 versões recentes. Artifact Registry tem 0,5 GB gratuitos compartilhados; imagem medida de cerca de 218 MB e cinco versões podem exceder franquia. Limpeza simula primeiro e só apaga depois dos pins. Sem scanning pago e sem Cloud Build.

Build/testes permanecem nos runners GitHub: padrão gratuito em repo público; privado consome minutos incluídos e pode gerar excedente. Cloud Run, Scheduler, egress, Secret Manager e logs do piloto mantêm custos anteriores. Franquias não são teto garantido de US$ 0. Fontes/limitações na ADR-0070.
