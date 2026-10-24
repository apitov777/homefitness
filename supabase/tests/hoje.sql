-- Teste do registro rápido de Hoje: "comeu outra coisa" (trocada) e "comeu algo a mais". Rode depois dos stubs e das migrations.
\set ON_ERROR_STOP 1
insert into auth.users values ('00000000-0000-0000-0000-0000000000f1','f1@x.com'),('00000000-0000-0000-0000-0000000000f3','f3@x.com');
create or replace function pg_temp.como(u text, e text) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claim.sub', u, false);
 perform set_config('request.jwt.claims', json_build_object('sub',u,'email',e)::text, false); end $$;
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000000f1','f1@x.com');
select public.criar_familia('Casa hoje', 'F1') as fam \gset
select id as pa from pessoa where user_id = auth.uid() \gset
insert into meta (pessoa_id, kcal, proteina_g) values (:'pa', 2000, 150);
select id as arroz from alimento where nome = 'Arroz, tipo 1, cozido' \gset
select id as frango from alimento where nome = 'Frango, peito, sem pele, grelhado' \gset
select id as banana from alimento where nome = 'Banana, prata, crua' \gset
select id as iogurte from alimento where nome = 'Iogurte, natural' \gset

-- Almoço todo dia com opção A (arroz + frango) e opção B (só frango).
select public.salvar_plano_refeicao(null, :'pa', 'almoco', null, '12:30', '{0,1,2,3,4,5,6}', false,
  jsonb_build_array(jsonb_build_object('alimento_id', :'arroz', 'quantidade_g', 150), jsonb_build_object('alimento_id', :'frango', 'quantidade_g', 120)),
  null, 700,
  jsonb_build_array(jsonb_build_object('nome', 'Só frango', 'itens', jsonb_build_array(jsonb_build_object('alimento_id', :'frango', 'quantidade_g', 300))))) as almoco \gset

-- 1. Comeu outra coisa no lugar do almoço: a refeição registrada traz o que comeu e a checagem fica "trocada".
select public.marcar_plano(:'almoco', '2026-10-26', 'trocada', jsonb_build_array(jsonb_build_object('alimento_id', :'banana', 'quantidade_g', 120), jsonb_build_object('alimento_id', :'iogurte', 'quantidade_g', 170))) as ref \gset
select 'trocada: itens do que comeu (esperado 2, 290 g)' t, count(*), sum(quantidade_g) from item_refeicao where refeicao_id = :'ref';
select 'trocada: checagem (esperado trocada, com refeicao, sem opcao)' t, status, refeicao_id is not null as com_refeicao, opcao_id is null as sem_opcao from plano_checagem where plano_refeicao_id = :'almoco' and data = '2026-10-26';
select 'trocada: tipo e hora vêm do plano (esperado almoco 12:30)' t, tipo, hora from refeicao where id = :'ref';
-- 2. Trocar sem dizer o que comeu não vale.
do $$ begin perform public.marcar_plano((select id from plano_refeicao where tipo='almoco' limit 1), '2026-10-27', 'trocada'); raise exception 'FALHA: trocada sem itens'; exception when raise_exception then raise notice 'ok: trocada sem itens recusada (%)', sqlerrm; end $$;
do $$ begin perform public.marcar_plano((select id from plano_refeicao where tipo='almoco' limit 1), '2026-10-27', 'trocada', '[]'); raise exception 'FALHA: trocada vazia'; exception when raise_exception then raise notice 'ok: trocada vazia recusada (%)', sqlerrm; end $$;
-- 3. A opção escolhida só vale quando foi feita: trocada com opção guarda opcao_id nulo.
select public.marcar_plano(:'almoco', '2026-10-27', 'trocada', jsonb_build_array(jsonb_build_object('alimento_id', :'banana', 'quantidade_g', 100)), (select id from plano_opcao where plano_refeicao_id = :'almoco')) as ref2 \gset
select 'trocada com opção: opcao_id nulo (esperado t)' t, opcao_id is null from plano_checagem where plano_refeicao_id = :'almoco' and data = '2026-10-27';
-- 4. Desfazer apaga a refeição registrada no lugar.
select public.desmarcar_plano(:'almoco', '2026-10-27');
select 'desfazer: refeição some (esperado 0)' t, count(*) from refeicao where id = :'ref2';
-- 5. Remarcar como feita com a opção B substitui a trocada.
select public.marcar_plano(:'almoco', '2026-10-26', 'feita', null, (select id from plano_opcao where plano_refeicao_id = :'almoco')) as ref3 \gset
select 'feita B no lugar da trocada: antiga some (esperado 0)' t, count(*) from refeicao where id = :'ref';
select 'feita B: frango 300 g' t, count(*), sum(quantidade_g) from item_refeicao where refeicao_id = :'ref3';
select 'feita B: checagem (esperado feita com opcao)' t, status, opcao_id is not null as com_opcao from plano_checagem where plano_refeicao_id = :'almoco' and data = '2026-10-26';
-- 6. Comeu algo a mais: refeição comum com a descrição "A mais", e o dia soma tudo.
select public.marcar_plano(:'almoco', '2026-10-28', 'trocada', jsonb_build_array(jsonb_build_object('alimento_id', :'banana', 'quantidade_g', 120)));
select public.registrar_refeicao(:'fam', '2026-10-28', 'lanche_tarde', '16:10', 'A mais', jsonb_build_array(jsonb_build_object('pessoa_id', :'pa', 'itens', jsonb_build_array(jsonb_build_object('alimento_id', :'iogurte', 'quantidade_g', 170)))));
select 'a mais: descrição no grupo (esperado A mais)' t, g.descricao from refeicao r join refeicao_grupo g on g.id = r.refeicao_grupo_id where r.data = '2026-10-28' and r.tipo = 'lanche_tarde';
select 'dia 28: banana 120 g + iogurte 170 g (esperado 204 kcal)' t, round(kcal) from v_dia_vs_meta where pessoa_id = :'pa' and data = '2026-10-28';
-- 7. O resumo da noite conta a trocada como feita (1 de 1).
reset role;
set role service_role;
select 'resumo qua 21:30 (esperado 1 de 1 feitas)' t, corpo like '%1 de 1 refeições do plano feitas%' as conta_trocada from public.avisos_devidos('2026-10-29 00:30:00+00') where chave like 'resumo:%';
reset role;
-- 8. Alguém de fora não marca.
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000000f3','f3@x.com');
do $$ begin perform public.marcar_plano((select id from plano_refeicao where tipo='almoco' and kcal_alvo = 700 limit 1), '2026-10-30', 'trocada', '[]'); raise exception 'FALHA: fora marcou'; exception when raise_exception or insufficient_privilege then raise notice 'ok: fora não marca (%)', sqlerrm; end $$;
reset role;
