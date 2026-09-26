-- Drive the existing GitHub Actions scraper from Supabase Cron so the dispatch is not
-- delayed by GitHub's best-effort `schedule` event queue.
-- Production requires a Vault secret named `farejo_github_actions_pat`, containing a
-- fine-grained PAT restricted to Joao-Victorsg/farejo with Actions: write permission.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Make re-application safe if this schedule is recreated manually during rollback/recovery.
do $migration$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname in (
    'farejo-scrape-full-0005-brt',
    'farejo-scrape-active-1500-brt'
  );

  perform cron.schedule(
    'farejo-scrape-full-0005-brt',
    '5 3 * * *', -- 00:05 America/Sao_Paulo (UTC-3)
    $cron$
      do $dispatch$
      declare
        github_pat text;
      begin
        select decrypted_secret
        into github_pat
        from vault.decrypted_secrets
        where name = 'farejo_github_actions_pat';

        if github_pat is null then
          raise exception 'Missing Vault secret: farejo_github_actions_pat';
        end if;

        perform net.http_post(
          url := 'https://api.github.com/repos/Joao-Victorsg/farejo/actions/workflows/scrape.yml/dispatches',
          headers := jsonb_build_object(
            'Accept', 'application/vnd.github+json',
            'Authorization', 'Bearer ' || github_pat,
            'Content-Type', 'application/json',
            'X-GitHub-Api-Version', '2022-11-28'
          ),
          body := jsonb_build_object(
            'ref', 'master',
            'inputs', jsonb_build_object('target', 'all')
          )
        );
      end
      $dispatch$;
    $cron$
  );

  perform cron.schedule(
    'farejo-scrape-active-1500-brt',
    '0 18 * * *', -- 15:00 America/Sao_Paulo (UTC-3)
    $cron$
      do $dispatch$
      declare
        github_pat text;
      begin
        select decrypted_secret
        into github_pat
        from vault.decrypted_secrets
        where name = 'farejo_github_actions_pat';

        if github_pat is null then
          raise exception 'Missing Vault secret: farejo_github_actions_pat';
        end if;

        perform net.http_post(
          url := 'https://api.github.com/repos/Joao-Victorsg/farejo/actions/workflows/scrape.yml/dispatches',
          headers := jsonb_build_object(
            'Accept', 'application/vnd.github+json',
            'Authorization', 'Bearer ' || github_pat,
            'Content-Type', 'application/json',
            'X-GitHub-Api-Version', '2022-11-28'
          ),
          body := jsonb_build_object(
            'ref', 'master',
            'inputs', jsonb_build_object('target', 'active-only')
          )
        );
      end
      $dispatch$;
    $cron$
  );
end
$migration$;
