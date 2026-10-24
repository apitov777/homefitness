-- Teste do plano de refeições e dos avisos: rode depois de 00_stub_auth.sql e das migrations.
\set ON_ERROR_STOP 1
insert into auth.users values ('00000000-0000-0000-0000-0000000000d1','d1@x.com'),('00000000-0000-0000-0000-0000000000d2','d2@x.com'),('00000000-0000-0000-0000-0000000000d3','d3@x.com');
create or replace function pg_temp.como(u text, e text) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claim.sub', u, false);
 perform set_config('request.jwt.claims', json_build_object('sub',u,'email',e)::text, false); end $$;
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000000d1','d1@x.com');
select public.criar_familia('Casa plano', 'D1') as fam \gset
select id as pa from pessoa where user_id = auth.uid() \gset
insert into pessoa (familia_id, nome) values (:'fam', 'D2') returning id as pb \gset
insert into familia_convite (familia_id, email, pessoa_id) values (:'fam', 'd2@x.com', :'pb');
insert into meta (pessoa_id, kcal, proteina_g) values (:'pa', 2000, 150);
select id as arroz from alimento where nome = 'Arroz, tipo 1, cozido' \gset
select id as frango from alimento where nome = 'Frango, peito, sem pele, grelhado' \gset

-- Almoço todo dia; jantar só de segunda a sexta.
insert into plano_refeicao (pessoa_id, tipo, hora) values (:'pa', 'almoco', '12:30') returning id as almoco \gset
insert into plano_item (plano_refeicao_id, alimento_id, quantidade_g, ordem) values (:'almoco', :'arroz', 150, 0), (:'almoco', :'frango', 120, 1);
insert into plano_refeicao (pessoa_id, tipo, nome, hora, dias) values (:'pa', 'jantar', 'Jantar leve', '19:30', '{1,2,3,4,5}') returning id as jantar \gset
insert into plano_item (plano_refeicao_id, alimento_id, quantidade_g) values (:'jantar', :'frango', 100);
-- A também monta o plano de B (família).
insert into plano_refeicao (pessoa_id, tipo, hora) values (:'pb', 'cafe', '07:00') returning id as cafeb \gset
do $$ begin insert into plano_refeicao (pessoa_id, tipo, hora, dias) values ((select id from pessoa where nome='D1'), 'ceia', '22:00', '{7}'); raise exception 'FALHA: dia 7 aceito'; exception when check_violation then raise notice 'ok: dias fora de 0..6 recusados'; end $$;

-- Feita como planejado: registra a refeição com os itens do plano.
select public.marcar_plano(:'almoco', '2026-10-26', 'feita') as ref \gset
select 'feita: itens (esperado 2)' t, count(*) from item_refeicao where refeicao_id = :'ref';
select 'kcal do dia (arroz 150 g + frango 120 g)' t, kcal, proteina_g from v_dia_vs_meta where pessoa_id = :'pa' and data = '2026-10-26';
-- Remarcar como pulada apaga a refeição registrada.
select public.marcar_plano(:'almoco', '2026-10-26', 'pulada');
select 'pulada: refeição apagada (esperado 0)' t, count(*) from refeicao where id = :'ref';
-- Feita diferente: itens informados.
select public.marcar_plano(:'almoco', '2026-10-26', 'feita', jsonb_build_array(jsonb_build_object('alimento_id', :'arroz', 'quantidade_g', 200), jsonb_build_object('alimento_id', :'frango', 'quantidade_g', 0))) as ref \gset
select 'diferente: só arroz 200 g' t, count(*), sum(quantidade_g) from item_refeicao where refeicao_id = :'ref';
do $$ begin perform public.marcar_plano((select id from plano_refeicao where tipo='almoco' and nome is null and hora='12:30' limit 1), '2026-10-27', 'feita', '[]'); raise exception 'FALHA: refeição vazia'; exception when raise_exception then raise notice 'ok: refeição sem alimento recusada (%)', sqlerrm; end $$;
-- Apagar a refeição pelo Hoje desfaz a marcação.
delete from refeicao where id = :'ref';
select 'apagou refeição: checagem some (esperado 0)' t, count(*) from plano_checagem where plano_refeicao_id = :'almoco';

-- Alguém de fora não vê nem mexe.
select pg_temp.como('00000000-0000-0000-0000-0000000000d3','d3@x.com');
select 'C ve planos (esperado 0)' t, count(*) from plano_refeicao;
do $$ begin perform public.marcar_plano((select id from plano_refeicao limit 1), current_date, 'pulada'); raise exception 'FALHA: C marcou'; exception when raise_exception then raise notice 'ok: C nao marca (%)', sqlerrm; end $$;
do $$ begin perform public.avisos_devidos(); raise exception 'FALHA: usuario chamou avisos_devidos'; exception when insufficient_privilege then raise notice 'ok: avisos_devidos fechado para usuarios'; end $$;

-- Avisos: um aparelho troca de dono quando outro usuário ativa nele.
select pg_temp.como('00000000-0000-0000-0000-0000000000d1','d1@x.com');
select public.inscrever_push('https://push.example/abc', 'p256', 'auth', 'iPhone');
select pg_temp.como('00000000-0000-0000-0000-0000000000d2','d2@x.com');
select public.aceitar_convites();
select public.inscrever_push('https://push.example/abc', 'p256', 'auth', 'iPhone');
select 'B ve o aparelho (esperado 1)' t, count(*) from push_inscricao;
select pg_temp.como('00000000-0000-0000-0000-0000000000d1','d1@x.com');
select 'A ve o aparelho (esperado 0)' t, count(*) from push_inscricao;

-- Marca o almoço de terça para testar que não avisa o que já foi marcado.
select public.marcar_plano(:'almoco', '2026-10-27', 'pulada');
reset role;
set role service_role;
-- Segunda 26/10 às 12:35 em São Paulo (15:35 UTC): almoço de A. B não tem plano às 12:30.
select 'seg 12:35' t, chave like 'refeicao:%' as refeicao, titulo, corpo from public.avisos_devidos('2026-10-26 15:35:00+00');
select 'seg 12:36 de novo (esperado 0)' t, count(*) from public.avisos_devidos('2026-10-26 15:36:00+00');
select 'seg 12:50 fora da janela (esperado 0)' t, count(*) from public.avisos_devidos('2026-10-26 15:50:00+00');
select 'ter 12:31 já marcado (esperado 0)' t, count(*) from public.avisos_devidos('2026-10-27 15:31:00+00');
select 'sab 19:31 jantar só dia útil (esperado 0)' t, count(*) from public.avisos_devidos('2026-10-31 22:31:00+00');
select 'sex 19:31 jantar' t, titulo, corpo from public.avisos_devidos('2026-10-30 22:31:00+00');
reset role;
set role authenticated;
select public.marcar_plano(:'almoco', '2026-10-26', 'feita');
reset role;
set role service_role;
select 'seg 21:30 resumo' t, titulo, corpo from public.avisos_devidos('2026-10-27 00:30:00+00') order by 1;
