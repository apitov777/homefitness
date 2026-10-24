-- Chama a função avisos a cada minuto (só no Supabase: pg_cron e pg_net não existem no Postgres local).
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'avisos-refeicoes',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://lgrbupnwlnzambbmsbih.supabase.co/functions/v1/avisos',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-avisos-token', (select token_cron from public.push_config where id = 1)
    ),
    body := '{"acao": "rodar"}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
