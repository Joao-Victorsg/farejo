-- F4/#113 (ADR-0063, ADR-0064, ADR-0066): fundação de dados dos Avisos.
--
-- Primeira PII do projeto. O contrato de dado mínimo (ADR-0066) começa aqui, na ausência de
-- coluna: o update do Telegram traz first_name, last_name, username, language_code e o texto
-- inteiro da mensagem, e nada disso tem onde ser gravado. O que não existe no banco não vaza,
-- não precisa de política de retenção e não aparece em backup.

create table subscribers (
  id                       bigint generated always as identity primary key,
  -- A identidade INTEIRA do Assinante. Um número de chat, nada mais.
  telegram_chat_id         bigint not null unique,
  -- Cursor de entrega (ADR-0063): é por assinante porque avançar depende de o envio ÀQUELE chat
  -- ter dado certo. Começa em 0 e não desenterra passado — quem garante isso é o filtro por
  -- `subscriptions.created_at` na detecção (#114), não um valor inicial esperto aqui.
  last_notified_history_id bigint not null default 0,
  created_at               timestamptz not null default now()
);

create table subscriptions (
  -- Apagar o Assinante leva as Inscrições junto: /parar é DELETE de verdade (ADR-0066) e as duas
  -- linhas são o mesmo agregado.
  subscriber_id     bigint not null references subscribers(id) on delete cascade,
  -- SEM `on delete cascade`, deliberadamente (ADR-0063). Um merge de alias termina em
  -- `delete from stores`; com cascade a Inscrição sumiria em silêncio e a pessoa nunca saberia
  -- que parou de ser avisada. Sem ele, o merge é OBRIGADO a tratar esta tabela (#115) — e falha
  -- alto se esquecer, que é o comportamento desejado.
  store_id          bigint not null references stores(id),
  mode              text not null,
  -- O Piso, tipado como Reward: um piso em `percent` só observa ofertas percentuais.
  floor_value       numeric(10,2),
  floor_reward_type text,
  created_at        timestamptz not null default now(),
  primary key (subscriber_id, store_id),

  constraint subscriptions_mode_valid check (mode in ('improvement', 'tracking')),
  constraint subscriptions_floor_reward_type_valid check (floor_reward_type in ('percent', 'fixed')),
  constraint subscriptions_floor_value_positive check (floor_value > 0),
  -- O invariante dos dois modos é do SCHEMA, não do código de aplicação: Modo acompanhamento
  -- exige Piso, Modo melhoria o proíbe. Uma inscrição em acompanhamento sem piso nunca avisaria
  -- nada, e o sintoma seria a AUSÊNCIA de mensagem — o pior modo de falha desta feature.
  constraint subscriptions_floor_matches_mode check (
    (mode = 'improvement' and floor_value is null and floor_reward_type is null)
    or (mode = 'tracking' and floor_value is not null and floor_reward_type is not null)
  )
);

-- O merge de alias (#115) e o job de Avisos (#114) varrem por loja.
create index idx_subscriptions_store on subscriptions (store_id);

alter table subscribers enable row level security;
alter table subscriptions enable row level security;

grant select, insert, update, delete on subscribers, subscriptions to service_role;

-- ---------------------------------------------------------------------------------------------
-- Duas roles, não uma (ADR-0064). A entrada é pública na internet; o job roda dentro do Actions.
-- Compartilhar uma role daria à superfície exposta leitura de `offer_history` inteiro, que ela
-- nunca usa — e é exatamente a promessa que a verificação negativa (ADR-0062) passa a afirmar.
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'farejo_bot') then
    create role farejo_bot login noinherit nosuperuser nocreatedb nocreaterole noreplication;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'farejo_notifier') then
    create role farejo_notifier login noinherit nosuperuser nocreatedb nocreaterole noreplication;
  end if;
end;
$$;

grant farejo_bot, farejo_notifier to postgres;

-- Caminho de usuário: o Telegram espera resposta rápida, e uma query lenta aqui vira timeout de
-- webhook. Mesmo teto de `farejo_web`. O `lock_timeout` é curto de propósito: o bot escreve no
-- caminho de usuário e vai disputar `stores` com o merge de alias (#115) — melhor falhar rápido e
-- pedir para tentar de novo do que segurar a requisição até o statement_timeout.
alter role farejo_bot set statement_timeout = '3s';
alter role farejo_bot set lock_timeout = '1500ms';
alter role farejo_bot set search_path = public, pg_catalog;

-- Job em lote, não caminho de usuário.
alter role farejo_notifier set statement_timeout = '30s';
alter role farejo_notifier set lock_timeout = '5s';
alter role farejo_notifier set search_path = public, pg_catalog;

-- Sobre as policies abaixo, todas `using (true)`: não há identidade de sessão no Postgres para
-- escopar por assinante — quem fala com o banco é o processo, não a pessoa. Então a role da
-- entrada pública consegue, por construção, enxergar qualquer `telegram_chat_id`. RLS aqui não é
-- isolamento entre assinantes; é a segunda camada que garante que quem NÃO tem policy (anon,
-- authenticated, qualquer role futura) não alcance a tabela por acidente. O isolamento real é da
-- aplicação (`apps/bot` só opera sobre o chat que assinou a requisição) somada às defesas de borda
-- da ADR-0065.

-- --------------------------------------------------------------------------------------------
-- farejo_bot: escreve Inscrições, lê o catálogo público. NUNCA `offer_history`, `offers` cruas,
-- curadoria, logos ou ativações.
-- --------------------------------------------------------------------------------------------
grant usage on schema public to farejo_bot;
grant usage on schema web_read to farejo_bot;

grant select, insert, delete on subscribers to farejo_bot;
create policy bot_select_subscribers on subscribers for select to farejo_bot using (true);
create policy bot_insert_subscribers on subscribers for insert to farejo_bot with check (true);
create policy bot_delete_subscribers on subscribers for delete to farejo_bot using (true);

grant select, insert, update, delete on subscriptions to farejo_bot;
create policy bot_select_subscriptions on subscriptions for select to farejo_bot using (true);
create policy bot_insert_subscriptions on subscriptions for insert to farejo_bot with check (true);
create policy bot_update_subscriptions on subscriptions for update to farejo_bot using (true) with check (true);
create policy bot_delete_subscriptions on subscriptions for delete to farejo_bot using (true);

-- Resolver `/start <slug>` → Loja canônica. O redirect vem da view pública, não da tabela crua:
-- link antigo de loja absorvida por um merge precisa continuar funcionando.
grant select on public.stores to farejo_bot;
create policy bot_select_stores on public.stores for select to farejo_bot using (true);
grant select on web_read.store_redirects, web_read.catalog_offers to farejo_bot;

-- Nota sobre as views de `web_read`: são `security_invoker = false` e pertencem a
-- `farejo_web_read_owner`, então o acesso às tabelas de baixo acontece como a dona. É por isso
-- que o bot enxerga a oferta corrente (para validar o Piso, #117) sem nenhum grant em
-- `public.offers` — e continua sem conseguir ler a tabela crua. A definição de Oferta pública
-- elegível (frescor de 48 h incluído) fica com um dono só, o do catálogo.

-- --------------------------------------------------------------------------------------------
-- farejo_notifier: lê o que o Aviso precisa; a única escrita é o cursor. `stores` e `platforms`
-- entram porque o texto do Aviso nomeia loja e plataforma — sem elas o job leria ids e não teria
-- como redigir a mensagem.
-- --------------------------------------------------------------------------------------------
grant usage on schema public to farejo_notifier;

grant select on subscribers to farejo_notifier;
create policy notifier_select_subscribers on subscribers for select to farejo_notifier using (true);

-- Grant por COLUNA: o job avança o cursor e nada mais. Trocar o chat de um assinante é escrita
-- que ele não tem por que conseguir fazer.
grant update (last_notified_history_id) on subscribers to farejo_notifier;
create policy notifier_update_subscribers on subscribers for update to farejo_notifier using (true) with check (true);

-- Revogação (ADR-0066): bloqueio do bot, 403 ou 400 apagam o assinante no mesmo run. As
-- Inscrições vão junto pelo cascade acima — ação de integridade referencial não precisa de
-- privilégio próprio sobre a tabela referenciante.
grant delete on subscribers to farejo_notifier;
create policy notifier_delete_subscribers on subscribers for delete to farejo_notifier using (true);

grant select on subscriptions to farejo_notifier;
create policy notifier_select_subscriptions on subscriptions for select to farejo_notifier using (true);

grant select on public.offer_history, public.offers, public.stores, public.platforms to farejo_notifier;
create policy notifier_select_offer_history on public.offer_history for select to farejo_notifier using (true);
create policy notifier_select_offers on public.offers for select to farejo_notifier using (true);
create policy notifier_select_stores on public.stores for select to farejo_notifier using (true);
create policy notifier_select_platforms on public.platforms for select to farejo_notifier using (true);
