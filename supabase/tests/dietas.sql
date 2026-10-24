-- Teste das dietas: dias por dieta, opções A/B/C por refeição e a marcação da opção comida.
\set ON_ERROR_STOP 1
insert into auth.users values ('00000000-0000-0000-0000-0000000000e1','e1@x.com'),('00000000-0000-0000-0000-0000000000e3','e3@x.com');
create or replace function pg_temp.como(u text, e text) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claim.sub', u, false);
 perform set_config('request.jwt.claims', json_build_object('sub',u,'email',e)::text, false); end $$;
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000000e1','e1@x.com');
select public.criar_familia('Casa dieta', 'E1') as fam \gset
select id as pa from pessoa where user_id = auth.uid() \gset
select id as arroz from alimento where nome = 'Arroz, tipo 1, cozido' \gset
select id as frango from alimento where nome = 'Frango, peito, sem pele, grelhado' \gset
select id as banana from alimento where nome = 'Banana, prata, crua' \gset
select id as aveia from alimento where nome like 'Aveia, flocos%' limit 1 \gset

-- Dieta de treino, seg a sex, com almoço de 3 opções e café de 1.
select public.salvar_dieta(null, :'pa', 'Dia de treino', 2450, '{1,2,3,4,5}') as treino \gset
select public.salvar_plano_refeicao(null, :'pa', 'almoco', null, '12:30', '{0,1,2,3,4,5,6}', true,
  jsonb_build_array(jsonb_build_object('alimento_id', :'arroz', 'quantidade_g', 200), jsonb_build_object('alimento_id', :'frango', 'quantidade_g', 150)),
  :'treino', 650,
  jsonb_build_array(
    jsonb_build_object('nome', 'Só frango', 'itens', jsonb_build_array(jsonb_build_object('alimento_id', :'frango', 'quantidade_g', 300))),
    jsonb_build_object('itens', jsonb_build_array(jsonb_build_object('alimento_id', :'arroz', 'quantidade_g', 300), jsonb_build_object('alimento_id', :'banana', 'quantidade_g', 100))))
) as almoco \gset
select public.salvar_plano_refeicao(null, :'pa', 'cafe', null, '07:00', '{0,1,2,3,4,5,6}', true,
  jsonb_build_array(jsonb_build_object('alimento_id', :'banana', 'quantidade_g', 120), jsonb_build_object('alimento_id', :'aveia', 'quantidade_g', 40)),
  :'treino', 400, '[]') as cafe \gset
select 'refeições da dieta (esperado 2)' t, count(*) from plano_refeicao where dieta_id = :'treino';
select 'dias vêm da dieta (esperado {1,2,3,4,5} / ativo t)' t, dias, ativo, kcal_alvo from plano_refeicao where id = :'almoco';
select 'opções B e C do almoço (esperado 2)' t, count(*) from plano_opcao where plano_refeicao_id = :'almoco';
select 'itens da opção C (esperado 2)' t, count(*) from plano_opcao_item i join plano_opcao o on o.id = i.plano_opcao_id where o.plano_refeicao_id = :'almoco' and o.ordem = 2;
do $$ begin
  perform public.salvar_plano_refeicao(null, (select id from pessoa where nome='E1'), 'jantar', null, '19:30', '{1}', true,
    jsonb_build_array(jsonb_build_object('alimento_id', (select id from alimento where nome='Arroz, tipo 1, cozido'), 'quantidade_g', 100)),
    (select id from dieta where nome='Dia de treino'), 600,
    jsonb_build_array(jsonb_build_object('itens', '[]'::jsonb)));
  raise exception 'FALHA: opção vazia aceita';
exception when raise_exception then raise notice 'ok: opção sem alimento recusada (%)', sqlerrm; end $$;

-- Dieta leve: ao pegar ter e qui, a de treino fica com seg, qua e sex.
select public.salvar_dieta(null, :'pa', 'Dia leve', 2050, '{2,4}') as leve \gset
select 'treino perdeu ter/qui (esperado {1,3,5})' t, dias from dieta where id = :'treino';
select 'refeições da treino acompanham (esperado {1,3,5})' t, dias from plano_refeicao where id = :'almoco';
-- Dieta sem dia: as refeições dela ficam inativas e somem de Hoje.
select public.salvar_dieta(:'leve', :'pa', 'Dia leve', 2050, '{}');
select public.salvar_plano_refeicao(null, :'pa', 'jantar', null, '19:30', '{0,1,2,3,4,5,6}', true,
  jsonb_build_array(jsonb_build_object('alimento_id', :'frango', 'quantidade_g', 150)), :'leve', 500, '[]') as jantar_leve \gset
select 'refeição de dieta sem dia fica inativa (esperado f)' t, ativo from plano_refeicao where id = :'jantar_leve';
select public.salvar_dieta(:'leve', :'pa', 'Dia leve', 2050, '{0,6}');
select 'com dias, volta a valer (esperado t / {0,6})' t, ativo, dias from plano_refeicao where id = :'jantar_leve';
do $$ begin perform public.salvar_dieta(null, (select id from pessoa where nome='E1'), '  ', 2000, '{1}'); raise exception 'FALHA: dieta sem nome'; exception when raise_exception then raise notice 'ok: dieta sem nome recusada (%)', sqlerrm; end $$;

-- Marcar: comeu a opção B na segunda; o registro leva os itens de B e a checagem guarda a opção.
select id as opb from plano_opcao where plano_refeicao_id = :'almoco' and ordem = 1 \gset
select public.marcar_plano(:'almoco', '2026-10-26', 'feita', null, :'opb') as ref \gset
select 'comeu a B: 1 item de 300 g de frango' t, count(*), sum(quantidade_g) from item_refeicao where refeicao_id = :'ref';
select 'checagem guarda a opção (esperado t)' t, opcao_id = :'opb' from plano_checagem where plano_refeicao_id = :'almoco' and data = '2026-10-26';
-- Sem opção: a de sempre (A).
select public.marcar_plano(:'almoco', '2026-10-27', 'feita') as ref2 \gset
select 'sem opção: A com 2 itens (esperado 2 / 350 g)' t, count(*), sum(quantidade_g) from item_refeicao where refeicao_id = :'ref2';
do $$ begin perform public.marcar_plano((select id from plano_refeicao where tipo='cafe' limit 1), '2026-10-26', 'feita', null, (select id from plano_opcao limit 1)); raise exception 'FALHA: opção de outra refeição'; exception when raise_exception then raise notice 'ok: opção de outra refeição recusada (%)', sqlerrm; end $$;
-- Editar a refeição troca as opções sem perder a marcação já feita.
select public.salvar_plano_refeicao(:'almoco', :'pa', 'almoco', null, '12:30', '{0,1,2,3,4,5,6}', true,
  jsonb_build_array(jsonb_build_object('alimento_id', :'arroz', 'quantidade_g', 200), jsonb_build_object('alimento_id', :'frango', 'quantidade_g', 150)),
  :'treino', 650, jsonb_build_array(jsonb_build_object('itens', jsonb_build_array(jsonb_build_object('alimento_id', :'frango', 'quantidade_g', 280)))));
select 'opções refeitas (esperado 1)' t, count(*) from plano_opcao where plano_refeicao_id = :'almoco';
select 'a refeição comida continua (esperado 1)' t, count(*) from refeicao where id = :'ref';
select 'a checagem continua, sem a opção antiga (esperado 1 / t)' t, count(*), bool_and(opcao_id is null) from plano_checagem where plano_refeicao_id = :'almoco' and data = '2026-10-26';

-- Apagar a dieta leva as refeições dela, mas não as refeições já comidas.
select public.apagar_dieta(:'treino');
select 'refeições da dieta apagadas (esperado 0)' t, count(*) from plano_refeicao where dieta_id = :'treino';
select 'refeições comidas ficam (esperado 2)' t, count(*) from refeicao where pessoa_id = :'pa';

-- Alguém de fora não vê nem mexe.
select pg_temp.como('00000000-0000-0000-0000-0000000000e3','e3@x.com');
select 'C ve dietas (esperado 0)' t, count(*) from dieta;
select 'C ve opções (esperado 0)' t, count(*) from plano_opcao;
do $$ begin perform public.salvar_dieta((select id from dieta limit 1), (select id from pessoa where nome='E1'), 'x', 1, '{1}'); raise exception 'FALHA: C editou dieta'; exception when insufficient_privilege or raise_exception then raise notice 'ok: C nao edita nem cria dieta para E1 (%)', sqlerrm; end $$;
reset role;
