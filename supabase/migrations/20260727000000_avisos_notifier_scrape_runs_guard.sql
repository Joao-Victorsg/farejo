-- F4/#119 (ADR-0063) — `farejo_notifier` ganha SELECT em `scrape_runs`, só para o guard do
-- workflow de Avisos recusar rodar enquanto houver um `scrape_runs` sem `finished_at`.
--
-- `nextval` de uma sequence não é transacional: uma transação pode reservar um id de
-- `offer_history` e commitar DEPOIS de outra que reservou um id maior. Se o job de Avisos ler
-- `max(id)` como marca d'água nesse intervalo, o id menor nasce abaixo dela e é perdido PARA
-- SEMPRE (todos os cursores já avançaram). Não existe watermark seguro com escritor concorrente;
-- a defesa é nunca deixar o job rodar enquanto um scrape ainda está escrevendo. O `workflow_run`
-- sobre o scrape concluído cobre o caso normal — este grant existe para o guard cobrir também o
-- `workflow_dispatch` de recuperação, que pode se sobrepor a um scrape manual em andamento.
grant select on public.scrape_runs to farejo_notifier;
create policy notifier_select_scrape_runs on public.scrape_runs for select to farejo_notifier using (true);
