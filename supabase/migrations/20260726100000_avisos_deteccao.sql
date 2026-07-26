-- F4/#114 (ADR-0063): detecção de Melhoria e das mudanças que interessam ao Modo acompanhamento.
--
-- A regra vive em SQL, não em TypeScript, porque achar "o último valor não-nulo do par
-- (loja, plataforma)" pede window/lateral sobre `offer_history` — e leitura derivada em SQL é o
-- padrão do projeto (`web_read.store_history`, `web_read.catalog_*`). Agrupar e redigir o texto
-- do Aviso é apresentação e fica no TypeScript (ADR-0064).
--
-- SECURITY INVOKER (o default) de propósito: `farejo_notifier` já tem os grants de que precisa
-- (#113), então a função não empresta privilégio a ninguém. Se um dia ela rodar sob outra role,
-- a role é que precisa provar acesso — não a função.
create schema if not exists alerts;

revoke all on schema alerts from public;
grant usage on schema alerts to farejo_notifier;

/**
 * Transições pendentes de TODOS os assinantes, já resolvidas com nome de loja e de plataforma.
 *
 * `p_max_history_id` é a marca d'água do run: o job a captura ANTES de processar e usa a mesma
 * para todo mundo, para que o cursor avance até um ponto único e conhecido.
 */
create function alerts.pending_avisos(p_max_history_id bigint)
returns table (
  subscriber_id     bigint,
  telegram_chat_id  bigint,
  history_id        bigint,
  store_slug        text,
  store_name        text,
  platform_id       text,
  platform_name     text,
  reward_type       text,
  value             double precision,
  is_upto           boolean,
  previous_value       double precision,
  previous_reward_type text,
  previous_is_upto     boolean,
  changed_at           timestamptz
)
language sql
stable
as $$
  with candidate as (
    select
      subs.id as subscriber_id,
      subs.telegram_chat_id,
      h.id as history_id,
      h.store_id,
      h.platform_id,
      h.reward_type,
      h.value,
      coalesce(h.is_upto, false) as is_upto,
      h.changed_at,
      ins.mode,
      ins.floor_value,
      ins.floor_reward_type
    from public.subscribers subs
    join public.subscriptions ins on ins.subscriber_id = subs.id
    join public.offer_history h
      on h.store_id = ins.store_id
      -- O cursor é por assinante (ADR-0063), e a marca d'água fecha a janela por cima.
      and h.id > subs.last_notified_history_id
      and h.id <= p_max_history_id
      -- Inscrição nova não desenterra passado.
      and h.changed_at >= ins.created_at
    -- Desativação (`value is null`) nunca é candidata: é isso que torna queda a zero e fim de
    -- oferta silenciosos nos DOIS modos, sem caso especial em lugar nenhum.
    where h.value is not null
  )
  select
    c.subscriber_id,
    c.telegram_chat_id,
    c.history_id,
    st.slug,
    st.name,
    c.platform_id,
    pl.name,
    c.reward_type,
    c.value::double precision,
    c.is_upto,
    prev.value::double precision,
    -- A grandeza do lado ANTERIOR precisa viajar junto: no Modo acompanhamento as duas pontas
    -- podem ter grandezas diferentes, e renderizar o valor antigo com a grandeza nova ("R$ 20"
    -- virando "20%") afirmaria uma queda percentual que nunca existiu.
    prev.reward_type,
    prev.is_upto,
    c.changed_at
  from candidate c
  join public.stores st on st.id = c.store_id
  join public.platforms pl on pl.id = c.platform_id
  -- A baseline é o último valor NÃO-NULO do par, não a linha imediatamente anterior. É o que faz
  -- desativação e reativação pelo mesmo valor serem invisíveis (ADR-0063).
  left join lateral (
    select p.value, p.reward_type, coalesce(p.is_upto, false) as is_upto
    from public.offer_history p
    where p.store_id = c.store_id
      and p.platform_id = c.platform_id
      and p.value is not null
      and (p.changed_at, p.id) < (c.changed_at, c.history_id)
    order by p.changed_at desc, p.id desc
    limit 1
  ) prev on true
  where case c.mode
    -- Melhoria: valor estritamente maior que a baseline, mesma grandeza nas duas pontas. Sem
    -- baseline, é oferta nova e qualifica. `is_upto` fora da comparação — igual ao ranking, que
    -- ordena up-to pelo valor; quem mostra a natureza é a mensagem.
    -- Mudança só em `value_partial` cai fora daqui de graça: ela grava uma linha com o MESMO
    -- `value`, e "maior que" é estrito.
    when 'improvement' then
      prev.value is null or (prev.reward_type = c.reward_type and c.value > prev.value)
    -- Acompanhamento: qualquer mudança que aterrisse no Piso ou acima, em qualquer direção. A
    -- comparação com o piso é INCLUSIVA: Piso é chão, e "valor mínimo de interesse" inclui o
    -- próprio valor — quem pediu "a partir de 10%" espera ser avisado quando a loja marcar
    -- exatamente 10%, e o sintoma de excluir a borda seria a ausência de mensagem, o pior modo de
    -- falha desta feature.
    --
    -- O terceiro termo é o que faz este modo ser sobre MUDANÇA, e não sobre estado. Sem ele, toda
    -- linha de histórico acima do piso vira Aviso, inclusive as que não mexeram no valor: mudança
    -- só em `value_partial` (grava linha com o mesmo `value`) e reativação pelo mesmo valor
    -- passariam a avisar "5% → 5%". No Modo melhoria isso já não acontecia de graça, porque
    -- "maior que" é estrito; aqui precisa ser dito.
    --
    -- `is_upto` fica FORA do teste de mudança, coerente com ele nunca participar de comparação:
    -- `10%` virar `até 10%` é mudança de natureza, não de valor, e segue silenciosa — mesma
    -- família da saída do piso, que também é silenciosa por decisão.
    when 'tracking' then
      c.reward_type = c.floor_reward_type
      and c.value >= c.floor_value
      and (prev.value is null or prev.reward_type <> c.reward_type or prev.value <> c.value)
    else false
  end
  order by c.telegram_chat_id, st.name, c.platform_id, c.history_id;
$$;

-- Funções nascem com EXECUTE para PUBLIC; sem este revoke a verificação negativa (ADR-0062)
-- reprovaria o deploy — corretamente.
revoke all on function alerts.pending_avisos(bigint) from public, anon, authenticated;
grant execute on function alerts.pending_avisos(bigint) to farejo_notifier;
