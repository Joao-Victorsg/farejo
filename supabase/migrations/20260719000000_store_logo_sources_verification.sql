-- F3/T15 (#61, ADR-0038): metadados privados de verificação da ingestão de logos.
--
-- ADR-0038 já previa estas colunas ("Ela registra a URL observada, last_seen_at e os
-- metadados privados de verificação definidos para a ingestão") — T11 só entregou url/
-- last_seen_at porque quem os define é o ingestor, implementado agora.
--
-- `verified_url`/`verified_at` guardam o que foi de fato baixado e checado, distinto de
-- `url`/`last_seen_at` (que o scrape reescreve a cada run, mesmo sem mudança real — ver
-- 20260718030000_store_logo_sources.sql). O entrypoint compara `url <> verified_url` (ou
-- `verified_at is null`) para decidir se uma fonte é "nova/alterada"; sem essa distinção,
-- toda fonte pareceria sempre nova a cada scrape.
--
-- `content_hash`/`width`/`height` só fazem sentido quando `verified_status = 'accepted'`
-- (imagem decodificada com sucesso); `rejection_reason` só quando `'rejected'`. Nenhuma
-- constraint cruzada aqui: a única leitora é o próprio ingestor, que já garante essa
-- coerência ao escrever.
alter table store_logo_sources
  add column verified_url      text,
  add column verified_at       timestamptz,
  add column verified_status   text check (verified_status in ('accepted', 'rejected')),
  add column rejection_reason  text,
  add column content_hash      text,
  add column width             integer,
  add column height            integer;

-- Sem GRANT adicional: 20260718060000_store_logos_storage.sql já concede
-- `select, update on store_logo_sources` a `farejo_logo_writer` para a tabela inteira
-- (linha completa, não lista de colunas), então as colunas novas já estão alcançáveis.
