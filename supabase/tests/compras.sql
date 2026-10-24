-- Teste da Compra da semana: marcações da família (já peguei) e opção escolhida por refeição. Rode depois dos stubs e das migrations.
\set ON_ERROR_STOP 1
insert into auth.users values ('00000000-0000-0000-0000-0000000000c1','c1@x.com'),('00000000-0000-0000-0000-0000000000c2','c2@x.com'),('00000000-0000-0000-0000-0000000000c3','c3@x.com');
create or replace function pg_temp.como(u text, e text) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claim.sub', u, false);
 perform set_config('request.jwt.claims', json_build_object('sub',u,'email',e)::text, false); end $$;
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1','c1@x.com');
select public.criar_familia('Casa compras', 'C1') as fam \gset
insert into pessoa (familia_id, nome) values (:'fam', 'C2') returning id as pb \gset
insert into familia_convite (familia_id, email, pessoa_id) values (:'fam', 'c2@x.com', :'pb');
select id as pa from pessoa where user_id = auth.uid() \gset
select id as pao from alimento where nome = 'Pão, trigo, francês' \gset
select id as ovo from alimento where nome = 'Ovo, de galinha, inteiro, cozido/10minutos' \gset
select public.salvar_plano_refeicao(null, :'pa', 'cafe', null, '07:00', '{1,2,3,4,5}', false,
  jsonb_build_array(jsonb_build_object('alimento_id', :'pao', 'quantidade_g', 50)), null, 400,
  jsonb_build_array(jsonb_build_object('nome', 'Ovos', 'itens', jsonb_build_array(jsonb_build_object('alimento_id', :'ovo', 'quantidade_g', 100))))) as cafe \gset
select id as opb from plano_opcao where plano_refeicao_id = :'cafe' \gset
select set_config('t.fam', :'fam', false), set_config('t.pao', :'pao', false), set_config('t.cafe', :'cafe', false), set_config('t.opb', :'opb', false);

-- 1. Marcar "já peguei" e escolher a opção B na semana de 26/10.
insert into compra_marcada (familia_id, semana, alimento_id) values (:'fam', '2026-10-26', :'pao');
insert into compra_opcao (familia_id, semana, plano_refeicao_id, opcao_id) values (:'fam', '2026-10-26', :'cafe', :'opb');
select 'marcado_por vem do login (esperado t)' t, marcado_por = auth.uid() from compra_marcada where alimento_id = :'pao';
-- 2. A semana é sempre a segunda-feira.
do $$ begin insert into compra_marcada (familia_id, semana, alimento_id) select familia_id, '2026-10-27', alimento_id from compra_marcada limit 1; raise exception 'FALHA: semana numa terça'; exception when check_violation then raise notice 'ok: semana fora da segunda recusada'; end $$;
-- 3. O outro da família vê e desmarca.
select pg_temp.como('00000000-0000-0000-0000-0000000000c2','c2@x.com');
select public.aceitar_convites();
select 'C2 vê a marcação e a escolha (esperado 1, 1)' t, (select count(*) from compra_marcada), (select count(*) from compra_opcao);
delete from compra_marcada where alimento_id = :'pao';
select 'C2 desmarcou (esperado 0)' t, count(*) from compra_marcada;
-- 4. Quem é de fora não vê nem grava.
select pg_temp.como('00000000-0000-0000-0000-0000000000c3','c3@x.com');
select public.criar_familia('Outra', 'C3') as fam3 \gset
select 'de fora vê (esperado 0, 0)' t, (select count(*) from compra_marcada), (select count(*) from compra_opcao);
do $$ begin insert into compra_marcada (familia_id, semana, alimento_id) values (current_setting('t.fam')::uuid, '2026-10-26', current_setting('t.pao')::uuid); raise exception 'FALHA: de fora marcou'; exception when insufficient_privilege then raise notice 'ok: de fora não marca na lista dos outros'; end $$;
-- 5. Na própria família, não dá para escolher a opção de uma refeição alheia.
do $$ begin insert into compra_opcao (familia_id, semana, plano_refeicao_id, opcao_id) values ((select id from familia where nome = 'Outra'), '2026-10-26', current_setting('t.cafe')::uuid, current_setting('t.opb')::uuid); raise exception 'FALHA: escolheu opção alheia'; exception when insufficient_privilege or foreign_key_violation then raise notice 'ok: opção de refeição de outra família recusada (%)', sqlstate; end $$;
-- 6. Apagar a opção B leva a escolha junto (volta para a A).
select pg_temp.como('00000000-0000-0000-0000-0000000000c1','c1@x.com');
delete from plano_opcao where id = :'opb';
select 'apagar a opção apaga a escolha (esperado 0)' t, count(*) from compra_opcao;
