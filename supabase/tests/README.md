# Testes do banco

Rodam as migrations num Postgres local (16+) com um stub do schema `auth` e conferem a RLS
com três usuários (Diego, marido e alguém de fora).

```bash
createdb hf
cat supabase/tests/00_stub_auth.sql supabase/migrations/*.sql | psql -v ON_ERROR_STOP=1 -d hf
psql -d hf -f supabase/tests/rls.sql   # todas as linhas NOTICE devem começar com "ok"
```
