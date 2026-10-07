# Plano inicial de segurança do CI/CD — Farejo

Projeto `farejo-510021`, revisão em 06/10/2026. Implementação: [ADR-0070](adr/0070-publicacao-do-scraper-no-cloud-run-por-terraform-e-oidc.md). Operação: [runbook](../infra/gcp/README.md).

## Mudanças propostas

Plano administrativo: **45 criações, 1 alteração, 1 remoção de binding IAM**.

- Dois buckets privados em `us-east1`: `farejo-510021-tfstate` e `farejo-510021-releases`. State com versionamento, soft delete e lock; plano privado com expiração.
- Três service accounts e três pools/providers WIF separados para publicar, planejar e aplicar. Confiança vinculada aos IDs imutáveis do repositório/proprietário, `master`, workflow e evento. Apply manual somente pelo proprietário, primeira tentativa.
- Roles/bindings limitados ao registry, Job, conta runner e prefixos de state. Scheduler tem apenas `jobs.get` no projeto: IAM Conditions não suporta seus atributos de recurso, então CI não recebe permissão de alteração nem `actAs` na conta Scheduler. Nenhuma identidade CI administra sua própria confiança/IAM ou lê valores do Secret Manager.
- APIs STS, IAM Credentials e Storage controladas pelo Terraform, sem desligamento automático em destroy.
- O plano inicial permitia tags mutáveis com publisher sem `tags.update`. A validação federada de 07/10/2026 comprovou que Docker ainda podia substituir tag descartável via `uploadArtifacts`; o candidato foi bloqueado. A correção administrativa aplicada alterou somente dois recursos: registry exige tags imutáveis e role dos pins perde `tags.update`. Job/Scheduler permaneceram intactos. Releases usam digest e pins únicos por aprovação; limpeza fica **em dry run**, com retenção administrativa separada.
- Remove `roles/editor` de `63868766178-compute@developer.gserviceaccount.com`. A conta permanece. Inventário atual: Job/Scheduler usam contas dedicadas, Compute/Cloud Build APIs não estão habilitadas e consulta de audit logs não encontrou uso dessa identidade no período consultado. Ausência de logs não prova ausência de todas as dependências.

O plano não muda imagem, configuração ou horário do piloto, orçamento ou valores dos quatro secrets. Job/Scheduler foram separados apenas no state local, com backup e conservação da quantidade de recursos; a migração para GCS ocorre depois da criação dos buckets.

## GitHub e ativação

- Dez repository variables com identificadores públicos; nenhum secret GCP novo.
- Actions de fornecedores usados, fixadas por SHA; token padrão somente leitura e sem aprovação automática de PR.
- `master` com CI `test` obrigatório, atualização obrigatória, conversas resolvidas e bloqueio de force push/exclusão. Nenhuma aprovação de outra pessoa obrigatória para impedir operação solo. Reavaliar suporte à proteção antes de tornar o repo privado.
- PR com CI Linux; merge aprovado instala os workflows. Autenticação OIDC real somente em `master` por decisão de segurança.
- Primeiro candidato/plano são preparados automaticamente após CI; **nenhuma imagem é ativada sem o release ID aprovado**.

## Revisão de código

### Standards

O baseline de mudanças foi corrigido para exigir job de deploy e etapa de apply/verificação realmente concluídos; workflow ignorado não conta como publicação. Zero pendências após a correção.

### Spec

Origem dos workflows valida caminho exato; contrato completo rejeita configuração adicional e disparo de execução; Scheduler permanece somente leitura. A validação live comprovou OIDC e push, mas revelou que a ausência de `tags.update` não bloqueia Docker. A correção exige imutabilidade no registry; nova preparação deve confirmar as duas negações antes de liberar candidato.

Resultado inicial: **0 findings estáticos pendentes em Standards e 0 em Spec**. O teste live motivou o reforço de imutabilidade; a correção também passa por revisão e teste federado.

## Custos e limites

WIF/IAM não acrescentam tarifa própria. Storage depende das franquias disponíveis na conta. Retenção de imagens pode ultrapassar os 0,5 GiB gratuitos do Artifact Registry. Com tags imutáveis não há limite automático de cinco versões: sem manutenção administrativa, o armazenamento cresce. Dez imagens distintas de 218 MB somariam cerca de 2 GiB, ou **US$ 0,15/mês** excedente à tarifa de US$ 0,10/GiB-mês, antes de deduplicação. Não é teto contratual. Artifacts temporários e minutos do GitHub privado também podem gerar excedentes. Custos do piloto existentes permanecem separados. O alerta de BRL 5,20 não bloqueia gastos. [Preço oficial](https://cloud.google.com/artifact-registry/pricing).

## Aprovação

A aprovação deve cobrir o plano administrativo salvo, a migração do state com backups, as configurações GitHub acima e o merge do PR. O primeiro release runtime terá sua própria revisão/aprovação. Não executar apply a partir de state vazio, nem substituir este fluxo por chave permanente.
