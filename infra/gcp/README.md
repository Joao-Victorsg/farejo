# Piloto do scraper Farejo no Google Cloud

O piloto mantém os dois jobs do Supabase Cron ativos e acrescenta uma execução Cloud Run diária às 09h de `America/Sao_Paulo`. O job executa `SCRAPE_PLATFORM=all` com `SCRAPE_TIER=active`; as caudas continuam exclusivamente no Supabase.

## Pré-requisitos

- Projeto Google Cloud com faturamento habilitado. A região padrão é `southamerica-east1`, próxima ao projeto Supabase Farejo (`sa-east-1`).
- Terraform 1.5+, Docker e Google Cloud CLI autenticados com uma conta autorizada a administrar o projeto.
- Informe o ID da conta de faturamento; o Terraform cria um alerta mensal de US$ 5. O alerta notifica, mas não bloqueia gastos.

## Provisionamento em etapas

1. Copie `terraform.tfvars.example` para `terraform.tfvars` e substitua o ID do projeto e da conta de faturamento. `terraform.tfvars` não deve ser commitado.
2. Aplique a base, com o job e o agendamento desligados:

   ```powershell
   terraform -chdir=infra/gcp init
   terraform -chdir=infra/gcp plan -var-file=terraform.tfvars
   terraform -chdir=infra/gcp apply -var-file=terraform.tfvars
   ```

3. No Secret Manager, crie a versão `1` dos segredos listados abaixo. Não coloque valores em arquivos do repositório, `terraform.tfvars`, argumentos de shell ou logs.

   | Secret Manager | Variável do container |
   | --- | --- |
   | `farejo-scraper-supabase-url` | `SUPABASE_URL` |
   | `farejo-scraper-supabase-service-role-key` | `SUPABASE_SERVICE_ROLE_KEY` |
   | `farejo-scraper-catalog-invalidation-url` | `CATALOG_INVALIDATION_URL` |
   | `farejo-scraper-catalog-invalidation-secret` | `CATALOG_INVALIDATION_SECRET` |

4. Construa e publique uma imagem Linux AMD64 identificada pelo SHA do commit. Use `image_uri_prefix` do Terraform como prefixo:

   ```powershell
   gcloud auth configure-docker southamerica-east1-docker.pkg.dev
   docker build --platform linux/amd64 -t IMAGE_URI .
   docker push IMAGE_URI
   ```

5. Defina `image_uri` em `terraform.tfvars`, altere `enable_job = true` e mantenha `enable_scheduler = false`. Aplique o Terraform novamente.
6. Execute um canário manual para Inter, sem sobreposição com outra coleta:

   ```powershell
   gcloud run jobs execute farejo-scraper `
     --region=southamerica-east1 `
     --update-env-vars=SCRAPE_PLATFORM=inter,SCRAPE_TIER=active
   ```

   A execução grava dados de produção. Confirme sucesso no Cloud Run e uma linha `scrape_runs` para Inter com a origem no JSON de `notes` (consulta: `notes::jsonb ->> 'execution_source' = 'cloud-run'`).

7. Após o canário passar, altere `enable_scheduler = true` e aplique outra vez. O recurso usa `0 9 * * *` no fuso `America/Sao_Paulo`, autentica com OAuth e não repete automaticamente uma chamada ou tarefa.
8. Observe sete execuções diárias. Compare cada execução Cloud Run com os cinco registros `scrape_runs` correspondentes; mantenha os jobs do Supabase como operação principal durante o piloto.

Para pausar somente o piloto, defina `enable_scheduler = false` e aplique. O Supabase Cron permanece ativo.

## Configuração e custos

- Uma tarefa e paralelismo 1, com 2 GiB de memória, 1 vCPU e timeout de 90 minutos, acima do timeout de 80 minutos da coleta ativa Méliuz no workflow atual.
- A conta de execução do Cloud Run pode ler apenas os quatro segredos; a identidade do Scheduler pode apenas invocar o job.
- Não há endpoint público. O Scheduler chama a API `run.googleapis.com` com OAuth.
- As respostas HTML/JSON baixadas são tráfego de entrada. O tráfego de saída inclui requisições e gravações no Supabase; a região brasileira pode gerar cobrança de egress para destinos na América do Sul.
- O alerta mensal de US$ 5 notifica os administradores do faturamento e, opcionalmente, do projeto; ele não é um limite rígido de gastos.
