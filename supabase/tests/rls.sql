-- Teste de RLS: rode depois de 00_stub_auth.sql e das migrations. Ver supabase/tests/README.md
\set ON_ERROR_STOP 1
insert into auth.users values ('00000000-0000-0000-0000-00000000000a','diego@x.com'),('00000000-0000-0000-0000-00000000000b','marido@x.com'),('00000000-0000-0000-0000-00000000000c','outro@x.com');
create or replace function pg_temp.como(u text, e text) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claim.sub', u, false);
 perform set_config('request.jwt.claims', json_build_object('sub',u,'email',e)::text, false); end $$;
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000000a','diego@x.com');
select public.criar_familia('Casa', 'Diego') as fam \gset
insert into pessoa (familia_id, nome, sexo) values (:'fam', 'Marido', 'M') returning id as pb \gset
select id as pa from pessoa where user_id = auth.uid() \gset
insert into familia_convite (familia_id, email, pessoa_id) values (:'fam', 'Marido@x.com', :'pb');
insert into meta (pessoa_id, kcal, proteina_g) values (:'pa', 2200, 150), (:'pb', 2600, 170);
select pg_temp.como('00000000-0000-0000-0000-00000000000b','marido@x.com');
select 'B aceita' t, public.aceitar_convites();
select 'B ve pessoas' t, count(*) from pessoa;
select id as arroz from alimento where codigo_fonte='3' \gset
select id as feijao from alimento where nome ilike 'Feijão, carioca, cozido' \gset
select public.registrar_refeicao(:'fam', current_date, 'almoco', '12:30', 'Arroz e feijão',
  jsonb_build_array(
    jsonb_build_object('pessoa_id', :'pa', 'itens', jsonb_build_array(jsonb_build_object('alimento_id', :'arroz', 'quantidade_g', 100), jsonb_build_object('alimento_id', :'feijao', 'quantidade_g', 140))),
    jsonb_build_object('pessoa_id', :'pb', 'itens', jsonb_build_array(jsonb_build_object('alimento_id', :'arroz', 'quantidade_g', 200), jsonb_build_object('alimento_id', :'feijao', 'quantidade_g', 280))))) as g \gset
select p.nome, v.kcal, v.proteina_g, v.meta_kcal from v_dia_vs_meta v join pessoa p on p.id=v.pessoa_id order by 1;
-- exames: B registra o seu; A não deve ver
insert into exame (pessoa_id, data) values (:'pb', current_date) returning id as eb \gset
insert into resultado_exame (exame_id, marcador_id, valor, ref_min, ref_max) select :'eb', id, 25, 30, 400 from marcador where codigo='ferritina';
select pg_temp.como('00000000-0000-0000-0000-00000000000a','diego@x.com');
select 'A ve exames de B (esperado 0)' t, count(*) from exame;
do $$ begin insert into exame (pessoa_id, data) select id, current_date from pessoa where nome='Marido'; raise exception 'FALHA: A inseriu exame de B'; exception when insufficient_privilege then raise notice 'ok: A bloqueado de inserir exame de B'; end $$;
select pg_temp.como('00000000-0000-0000-0000-00000000000b','marido@x.com');
update pessoa set compartilha_exames = true where user_id = auth.uid();
select pg_temp.como('00000000-0000-0000-0000-00000000000a','diego@x.com');
select 'A ve exames de B apos compartilhar (esperado 1)' t, count(*) from exame;
select 'flag', flag from resultado_exame;
select pg_temp.como('00000000-0000-0000-0000-00000000000c','outro@x.com');
select 'C ve' t, (select count(*) from pessoa) pessoas, (select count(*) from refeicao) refeicoes, (select count(*) from familia) fam, (select count(*) from exame) exames, (select count(*) from alimento) alimentos;
do $$ begin perform public.registrar_refeicao((select id from familia limit 1), current_date, 'almoco', null, null, '[]'); exception when others then raise notice 'ok C: %', sqlerrm; end $$;
select pg_temp.como('00000000-0000-0000-0000-00000000000b','marido@x.com');
update pessoa set compartilha_exames = false where user_id = auth.uid();
select pg_temp.como('00000000-0000-0000-0000-00000000000a','diego@x.com');
do $$ begin update pessoa set compartilha_exames = true where nome='Marido'; raise exception 'FALHA compartilha'; exception when insufficient_privilege then raise notice 'ok: A nao muda compartilhamento de B'; end $$;
do $$ begin update pessoa set user_id = auth.uid() where nome='Marido'; raise exception 'FALHA user_id'; exception when insufficient_privilege or unique_violation then raise notice 'ok: A nao assume login de B'; end $$;
do $$ begin delete from pessoa where nome='Marido'; raise exception 'FALHA delete'; exception when insufficient_privilege then raise notice 'ok: A nao apaga B'; end $$;
update pessoa set altura_cm = 180 where nome='Marido';
select 'A edita altura de B (ok)' t, altura_cm from pessoa where nome='Marido';
select pg_temp.como('00000000-0000-0000-0000-00000000000b','marido@x.com');
update pessoa set data_nascimento='1990-01-01' where user_id=auth.uid();
select nome, efeito, media_dia, dias_registrados, rda, pct_rda from public.ingestao_antes_exame_detalhe((select id from resultado_exame limit 1));
