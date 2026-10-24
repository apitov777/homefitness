# Testes do banco

Rodam as migrations num Postgres local (16+) com um stub do schema `auth` e conferem a RLS
com três usuários (Diego, marido e alguém de fora).

```bash
createdb hf
# a migration do cron só roda no Supabase (pg_cron e pg_net)
cat supabase/tests/00_stub_auth.sql $(ls supabase/migrations/*.sql | grep -v avisos_cron) | psql -v ON_ERROR_STOP=1 -d hf
psql -d hf -f supabase/tests/rls.sql     # todas as linhas NOTICE devem começar com "ok"
psql -d hf -f supabase/tests/plano.sql   # NOTICE "ok" e as contagens batendo com o "esperado"
psql -d hf -f supabase/tests/familia.sql # papéis, convites, entrar, sair e remover: NOTICE "ok" e "esperado"
```
