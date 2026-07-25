-- #65 (ADR-0062): hardening da superfície negativa de anon/authenticated no schema public.
--
-- A enumeração real do ACL (aclexplode, não `has_*_privilege`) revelou que anon/authenticated
-- carregam o baseline default do Supabase em public, que nenhuma migration do farejô concedeu:
--   - TRUNCATE/REFERENCES/TRIGGER/MAINTAIN em toda tabela (default ACL do role `postgres`, dono
--     de todas as tabelas do produto — confirmado: nenhuma é de supabase_admin, cujo default
--     concederia arwdDxtm, ou seja, SELECT/DML também);
--   - UPDATE em toda sequence;
--   - USAGE no schema public concedido DIRETO a anon/authenticated — o `revoke usage on schema
--     public from public` da 20260717000000 nunca os atingiu, porque revoga do pseudo-role PUBLIC,
--     não de grants diretos.
--
-- Nada disso é explorável hoje: anon/authenticated são NOLOGIN e o farejô nunca usa a Data API
-- (toda leitura pública é server-only via farejo_web nas views web_read). Mas o contrato do farejô
-- é superfície mínima, e "não-explorável" não é "inexistente": TRUNCATE é destrutivo, e o grant
-- ficaria armado se algum dia um vetor aparecesse. Revogamos, e a verificação negativa
-- (packages/db-audit, ADR-0062) passa a exigir que continue revogado — sem depender de RLS como
-- única camada.
--
-- Seguro para o farejô: nenhum caminho do produto usa anon/authenticated. Storage/Auth/Realtime do
-- Supabase operam nos seus próprios schemas (storage/auth/realtime), não em public — revogar o
-- acesso deles a public não os toca. A policy pública de logos vive em storage.objects e não
-- depende de USAGE no schema public. Validado ao vivo: a suíte de integração inteira (service_role
-- + farejo_web + farejo_logo_writer, nunca anon/authenticated) continua verde após este revoke.

-- 1. Objetos existentes.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- 2. USAGE no schema (grant direto que sobreviveu ao revoke from public da 20260717000000).
revoke usage on schema public from anon, authenticated;

-- 3. Objetos FUTUROS: sem neutralizar o default ACL, a próxima tabela/sequence criada por postgres
--    reganharia o baseline e a verificação negativa passaria a falhar sozinha no deploy seguinte.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
