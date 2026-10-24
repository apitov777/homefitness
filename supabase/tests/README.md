# Testes do banco

Rodam as migrations num Postgres local (16+) com stubs dos schemas `auth` e `storage` (`0*_stub_*.sql`) e conferem a RLS
com três usuários (Diego, marido e alguém de fora).

```bash
createdb hf
# a migration do cron só roda no Supabase (pg_cron e pg_net)
cat supabase/tests/0*_stub_*.sql $(ls supabase/migrations/*.sql | grep -v avisos_cron) | psql -v ON_ERROR_STOP=1 -d hf
psql -d hf -f supabase/tests/rls.sql     # todas as linhas NOTICE devem começar com "ok"
psql -d hf -f supabase/tests/plano.sql   # NOTICE "ok" e as contagens batendo com o "esperado"
psql -d hf -f supabase/tests/familia.sql # papéis, convites, entrar, sair e remover: NOTICE "ok" e "esperado"
psql -d hf -f supabase/tests/semana.sql  # receitas, cardápio do dia, treinos e meta do dia: NOTICE "ok" e "esperado"
psql -d hf -f supabase/tests/catalogo.sql # catálogo de receitas (só leitura), favoritas por pessoa e cópia adaptada: NOTICE "ok" e "esperado"
psql -d hf -f supabase/tests/dietas.sql  # dietas por dia da semana, opções A/B/C e marcar com a opção comida: NOTICE "ok" e "esperado"
```
