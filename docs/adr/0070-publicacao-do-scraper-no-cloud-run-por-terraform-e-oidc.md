# ADR-0070 — Publicação do scraper no Cloud Run por Terraform e OIDC

Data: 2026-10-06. Decisão aprovada na conversa; ativação depende do plano administrativo revisado.

## Contexto

O piloto executa às 09h de America/Sao_Paulo. Supabase Cron continua como operação principal às 00h05 e 15h. O CI/CD precisa publicar mudanças relevantes e preservar os testes existentes, preparando um plano revisável antes de qualquer apply. O repositório pode se tornar privado.

## Decisão

- `terraform apply` é o deploy de produção do scraper. A imagem por digest e o Scheduler pertencem ao mesmo state operacional. Não existe atualização paralela por `gcloud run jobs update`.
- O state administrativo mantém APIs, repositório, secrets, permissões, orçamento, WIF e buckets. A identidade cotidiana de deploy não pode administrar essa base.
- Scheduler permanece no state operacional como contrato fixo, mas a pipeline só aceita `no-op` nele. Como IAM Conditions não oferece atributos de recurso do Scheduler, concedemos apenas `jobs.get` no projeto; alterar agendamento exige administrador e plano aprovado fora da pipeline. Não ampliamos CI para editar todos os agendamentos.
- Três pools WIF isolam publicação, planejamento e deploy. A confiança exige IDs imutáveis de proprietário/repositório, master e workflow específico. Deploy exige evento manual do proprietário e primeira tentativa.
- A preparação parte de CI bem-sucedido de push na master e compara os caminhos relevantes com a última publicação bem-sucedida. Build e teste de container não têm `id-token: write`. Outro job publica o mesmo arquivo de imagem testado, validando seu checksum e ID.
- A imagem executa parsers reais das cinco plataformas com fixtures, Supabase exclusivo local e invalidação HMAC simulada. Qualquer URL externa inesperada falha. Nenhum teste faz coleta ou escrita de produção.
- Um workflow separado salva o plano e o manifesto em GCS privado. O resumo público mostra somente SHA, digest e ações dos recursos. O usuário aprova por workflow_dispatch do ID da release; não dependemos de reviewers de environments privados.
- O apply exige CI e preparação de origem válidos, master atual, plano íntegro por hash/generation, aprovação com menos de 24 horas, infraestrutura equivalente ao plano revisado e estado anterior do job preservado. Criações, exclusões, substituições e ampliação do contrato operacional são bloqueadas.
- A pipeline termina ao verificar a configuração publicada. Não inicia, espera nem acompanha a coleta das 09h.
- State usa locking, versionamento, bloqueio público e caminhos separados. Migração local/remota preserva recursos e lineages; os backups ficam privados.
- Releases usam digest e o registry exige tags imutáveis. A validação federada de 07/10/2026 demonstrou que `uploadArtifacts` permite substituir tags via Docker mesmo sem `tags.update`; o candidato foi bloqueado, sem mudar a imagem do piloto. A imutabilidade do registry impede esse caminho. Pins iniciais `protected-current` e `protected-previous` permanecem como âncora; cada aprovação cria `protected-current-ID` e `protected-previous-ID`, sem mover tags existentes. Antes de liberar candidato, a preparação testa push novo e substituição negada via API e Docker em tag descartável, conferindo o digest preservado. Cleanup permanece em dry run: Google proíbe apagar artefatos com tags imutáveis. Retenção exige manutenção administrativa separada, preservando imagem vigente, rollback e âncora inicial. Não desativar a proteção durante publicações; o prepare rejeita registry mutável. Sem conceder permissões amplas para contornar falhas.

## Consequências

Nenhuma chave Google permanente é armazenada no GitHub. Publicação escreve imagens/tags novas no registry; planejamento lê infraestrutura/state e só escreve lock e novos objetos de release; deploy atualiza apenas Job, state operacional e pins. Scheduler é consultado, não alterado. Runtime lê quatro secrets; identidade de invocação do Scheduler mantém somente invocação do job.

Validação federada do apply em 07/10/2026: Cloud Run exige que o deployer possa baixar a imagem selecionada (`artifactregistry.repositories.downloadArtifacts`). A role dos pins concede essa leitura somente no registry Farejo; não recebe upload, alteração ou exclusão. Audit logs confirmaram a negação antes de atualizar o Job. A correção administrativa acrescenta uma permissão de leitura, sem mudar confiança, secrets ou agendamento.

A permissão de trocar a imagem permite acesso indireto aos secrets do runtime. Aprovação e proteção do código são essenciais. A credencial Supabase service_role continua elevada; substituí-la por uma role restrita exige um trabalho específico de grants e compatibilidade do scraper, sem fingir que WIF reduz seus privilégios.

Cloud Storage nos limites gratuitos e WIF não acrescentam mensalidade. Imagens, operações excedentes, logs e minutos do GitHub privado podem ser cobrados. Sem retenção administrativa, imagens acumulam; cinco versões recentes não constituem um limite automático. O orçamento de BRL 5,20 é um alerta, sem corte automático.

## Referências

- https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines
- https://developer.hashicorp.com/terraform/language/backend/gcs
- https://docs.cloud.google.com/artifact-registry/docs/repositories/cleanup-policy
- https://docs.cloud.google.com/iam/docs/conditions-resource-attributes
- https://docs.cloud.google.com/iam/docs/roles-permissions/artifactregistry
- https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
