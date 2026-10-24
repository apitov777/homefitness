-- Teste de receitas, cardápio da semana, treinos e meta do dia: rode depois de 00_stub_auth.sql e das migrations.
\set ON_ERROR_STOP 1
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000e1','e1@x.com'),
  ('00000000-0000-0000-0000-0000000000e2','e2@x.com'),
  ('00000000-0000-0000-0000-0000000000e3','e3@x.com');
create or replace function pg_temp.como(u text, e text) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claim.sub', u, false);
 perform set_config('request.jwt.claims', json_build_object('sub',u,'email',e)::text, false); end $$;
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000000e1','e1@x.com');
select public.criar_familia('Casa semana', 'E1') as fam \gset
select id as pe from pessoa where user_id = auth.uid() \gset
select id as arroz from alimento where nome = 'Arroz, tipo 1, cozido' \gset
select id as frango from alimento where nome = 'Frango, peito, sem pele, grelhado' \gset
select id as feijao from alimento where nome = 'Feijão, carioca, cozido' \gset
select id as energia from nutriente where codigo = 'energia' \gset
select id as proteina from nutriente where codigo = 'proteina' \gset
insert into meta (pessoa_id, inicio, tmb_kcal, tdee_kcal, kcal, proteina_g, carboidrato_g, gordura_g)
  values (:'pe', '2026-10-01', 1700, 2400, 2000, 160, 200, 60);
insert into medida_corporal (pessoa_id, data, peso_kg) values (:'pe', '2026-10-01', 80), (:'pe', '2026-10-28', 70);

-- Receita: arroz 300 g + frango 200 g + feijão 100 g, 500 g pronta.
-- Energia por 100 g = (128 × 3 + 159 × 2 + 76 × 1) / 500 × 100 = 155,6 kcal; proteína = 15,28 g.
select public.salvar_receita(null, 'Frango com arroz e feijão', '{almoco,jantar}', 500, 'Tudo na mesma panela.',
  jsonb_build_array(jsonb_build_object('alimento_id', :'arroz', 'quantidade_g', 300),
                    jsonb_build_object('alimento_id', :'frango', 'quantidade_g', 200),
                    jsonb_build_object('alimento_id', :'feijao', 'quantidade_g', 100))) as rec \gset
select alimento_id as rec_al from receita where id = :'rec' \gset
select 'receita vira alimento da família' t, fonte, categoria, familia_id = :'fam' as da_familia from alimento where id = :'rec_al';
select 'energia por 100 g (esperado 155.6)' t, valor_por_100g from alimento_nutriente where alimento_id = :'rec_al' and nutriente_id = :'energia';
select 'proteína por 100 g (esperado 15.28)' t, valor_por_100g from alimento_nutriente where alimento_id = :'rec_al' and nutriente_id = :'proteina';
do $$ begin perform public.salvar_receita(null, 'Vazia', '{almoco}', 300, null, '[]'); raise exception 'FALHA: receita vazia'; exception when raise_exception then raise notice 'ok: receita sem ingrediente recusada (%)', sqlerrm; end $$;
do $$ begin perform public.salvar_receita(null, 'Sem peso', '{almoco}', 0, null, '[{"alimento_id":"00000000-0000-0000-0000-000000000000","quantidade_g":10}]'); raise exception 'FALHA: sem rendimento'; exception when raise_exception then raise notice 'ok: receita sem peso pronto recusada (%)', sqlerrm; end $$;
do $$ begin perform public.salvar_receita(null, 'Tipo errado', '{brunch}', 300, null, '[]'); raise exception 'FALHA: tipo inválido'; exception when check_violation or raise_exception then raise notice 'ok: tipo de refeição fora da lista recusado'; end $$;

-- Almoço de sempre: arroz 150 g + frango 120 g. Na segunda 26/10, a receita (350 g) entra no lugar.
insert into plano_refeicao (pessoa_id, tipo, hora) values (:'pe', 'almoco', '12:30') returning id as almoco \gset
insert into plano_item (plano_refeicao_id, alimento_id, quantidade_g, ordem) values (:'almoco', :'arroz', 150, 0), (:'almoco', :'frango', 120, 1);
select public.definir_dias(jsonb_build_array(
  jsonb_build_object('plano', :'almoco', 'data', '2026-10-26', 'receita', :'rec',
                     'itens', jsonb_build_array(jsonb_build_object('alimento_id', :'rec_al', 'quantidade_g', 350))),
  jsonb_build_object('plano', :'almoco', 'data', '2026-10-28', 'receita', :'rec',
                     'itens', jsonb_build_array(jsonb_build_object('alimento_id', :'rec_al', 'quantidade_g', 300),
                                                jsonb_build_object('alimento_id', :'feijao', 'quantidade_g', 0))))) as n;
select 'dias com cardápio (esperado 2)' t, count(*) from plano_dia where plano_refeicao_id = :'almoco';
select 'quarta ignora item com 0 g (esperado 1)' t, count(*) from plano_dia_item di join plano_dia d on d.id = di.plano_dia_id where d.data = '2026-10-28';
do $$ begin perform public.definir_dias(jsonb_build_array(jsonb_build_object('plano', (select id from plano_refeicao where tipo = 'almoco' and hora = '12:30' and pessoa_id = (select id from pessoa where nome = 'E1')), 'data', '2026-10-29', 'itens', '[{"alimento_id":"00000000-0000-0000-0000-000000000000","quantidade_g":0}]'::jsonb))); raise exception 'FALHA: dia vazio'; exception when raise_exception then raise notice 'ok: dia sem alimento recusado (%)', sqlerrm; end $$;

-- Marcar como feita usa o cardápio do dia; na terça, os itens de sempre.
select public.marcar_plano(:'almoco', '2026-10-26', 'feita') as ref_seg \gset
select 'segunda: receita 350 g' t, count(*), sum(quantidade_g), bool_and(alimento_id = :'rec_al') as da_receita from item_refeicao where refeicao_id = :'ref_seg';
select 'kcal da segunda (esperado 545)' t, kcal from v_dia_vs_meta where pessoa_id = :'pe' and data = '2026-10-26';
select public.marcar_plano(:'almoco', '2026-10-27', 'feita') as ref_ter \gset
select 'terça: plano de sempre (esperado 2 itens, 270 g)' t, count(*), sum(quantidade_g) from item_refeicao where refeicao_id = :'ref_ter';

-- Mudar a receita já comida guarda a versão antiga e passa o plano para a nova (rende 600 g agora).
select public.salvar_receita(:'rec', 'Frango com arroz e feijão', '{almoco,jantar}', 600, null,
  jsonb_build_array(jsonb_build_object('alimento_id', :'arroz', 'quantidade_g', 300),
                    jsonb_build_object('alimento_id', :'frango', 'quantidade_g', 200),
                    jsonb_build_object('alimento_id', :'feijao', 'quantidade_g', 100))) = :'rec' as mesma_receita;
select alimento_id as rec_al2 from receita where id = :'rec' \gset
select 'nova versão é outro alimento' t, :'rec_al2' <> :'rec_al' as nova, (select ativo from alimento where id = :'rec_al') as antiga_ativa;
select 'energia nova (esperado 129.6667)' t, valor_por_100g from alimento_nutriente where alimento_id = :'rec_al2' and nutriente_id = :'energia';
select 'histórico mantém a versão comida' t, bool_and(alimento_id = :'rec_al') from item_refeicao where refeicao_id = :'ref_seg';
select 'kcal da segunda continua (esperado 545)' t, kcal from v_dia_vs_meta where pessoa_id = :'pe' and data = '2026-10-26';
select 'quarta aponta para a nova' t, bool_and(di.alimento_id = :'rec_al2') from plano_dia_item di join plano_dia d on d.id = di.plano_dia_id where d.data = '2026-10-28';

-- Receita ainda não comida: editar mantém o mesmo alimento. Arquivar tira das listas.
select public.salvar_receita(null, 'Escondidinho', '{jantar}', 800, null,
  jsonb_build_array(jsonb_build_object('alimento_id', :'frango', 'quantidade_g', 400))) as rec2 \gset
select alimento_id as rec2_al from receita where id = :'rec2' \gset
select public.salvar_receita(:'rec2', 'Escondidinho de frango', '{jantar}', 700, null,
  jsonb_build_array(jsonb_build_object('alimento_id', :'frango', 'quantidade_g', 400)));
select 'sem histórico: mesmo alimento renomeado' t, alimento_id = :'rec2_al' as mesmo, (select nome from alimento where id = :'rec2_al') from receita where id = :'rec2';
select public.arquivar_receita(:'rec2');
select 'arquivada' t, r.ativa, a.ativo from receita r join alimento a on a.id = r.alimento_id where r.id = :'rec2';

-- Itens vazios voltam o dia ao plano de sempre.
select public.definir_dias(jsonb_build_array(jsonb_build_object('plano', :'almoco', 'data', '2026-10-28', 'itens', '[]'::jsonb)));
select 'quarta voltou ao plano (esperado 0)' t, count(*) from plano_dia where plano_refeicao_id = :'almoco' and data = '2026-10-28';

-- Treinos: musculação seg/qua/sex 60 min a 5 MET; corrida de sábado com 450 kcal do relógio.
insert into treino_plano (pessoa_id, atividade, met, minutos, dias, hora) values (:'pe', 'Musculação', 5, 60, '{1,3,5}', '18:00');
insert into treino_plano (pessoa_id, atividade, minutos, kcal_informada, dias) values (:'pe', 'Corrida', 40, 450, '{6}');
do $$ begin insert into treino_plano (pessoa_id, atividade, minutos, dias) values ((select id from pessoa where nome = 'E1'), 'Nada', 30, '{1}'); raise exception 'FALHA: treino sem gasto'; exception when check_violation then raise notice 'ok: treino precisa de MET ou kcal'; end $$;

-- Meta fixa: 2.000 kcal todo dia; o treino aparece mas não muda a meta.
select 'fixa' t, data, kcal, carboidrato_g, gasto_kcal, treino_kcal, pelo_treino
  from public.metas_do_periodo(array[:'pe']::uuid[], '2026-10-25', '2026-10-28');
-- Pelo treino: (1.700 × 1,2 + treino) × 2.000/2.400.
-- dom 25: 2.040 → 1.700 kcal, carb 125 g. seg 26: 2.360 → 1.967 kcal, carb 192 g (treino 4 × 80 kg × 1 h = 320).
-- qua 28: peso novo 70 kg, treino 280 → 2.320 → 1.933 kcal. sáb 31: 2.490 → 2.075 kcal, carb 219 g.
update pessoa set meta_pelo_treino = true where id = :'pe';
select 'pelo treino' t, data, kcal, proteina_g, carboidrato_g, gordura_g, gasto_kcal, treino_kcal, pelo_treino
  from public.metas_do_periodo(array[:'pe']::uuid[], '2026-10-25', '2026-10-31');
-- Nunca abaixo da TMB.
update meta set kcal = 1500 where pessoa_id = :'pe';
select 'piso na TMB (esperado 1700)' t, kcal from public.metas_do_periodo(array[:'pe']::uuid[], '2026-10-25', '2026-10-25');
update meta set kcal = 2000 where pessoa_id = :'pe';
select 'período acima de 62 dias (esperado 0)' t, count(*) from public.metas_do_periodo(array[:'pe']::uuid[], '2026-10-01', '2026-12-31');
do $$ begin update pessoa set fator_rotina = 2 where nome = 'E1'; raise exception 'FALHA: fator 2 aceito'; exception when check_violation then raise notice 'ok: fator da rotina entre 1,1 e 1,6'; end $$;

-- E2 entra na família com um almoço próprio que usa a receita; ao ser removido, leva o cardápio.
insert into familia_convite (familia_id, nome) values (:'fam', 'E2') returning codigo as cod \gset
select pg_temp.como('00000000-0000-0000-0000-0000000000e2','e2@x.com');
select public.aceitar_convite(:'cod', 'E2');
select id as pe2 from pessoa where user_id = auth.uid() \gset
insert into plano_refeicao (pessoa_id, tipo, hora) values (:'pe2', 'almoco', '12:00') returning id as almoco2 \gset
insert into plano_item (plano_refeicao_id, alimento_id, quantidade_g) values (:'almoco2', :'arroz', 200);
select public.definir_dias(jsonb_build_array(jsonb_build_object('plano', :'almoco2', 'data', '2026-10-26', 'receita', :'rec',
  'itens', jsonb_build_array(jsonb_build_object('alimento_id', :'rec_al2', 'quantidade_g', 250)))));
insert into treino_plano (pessoa_id, atividade, met, minutos, dias) values (:'pe2', 'Pedal', 7, 45, '{2,4}');
select 'E2 ve a receita da família (esperado 2)' t, count(*) from receita;
select pg_temp.como('00000000-0000-0000-0000-0000000000e1','e1@x.com');
select 'E1 ve o treino de E2 (esperado 3)' t, count(*) from treino_plano;
select public.remover_membro('00000000-0000-0000-0000-0000000000e2');
select pg_temp.como('00000000-0000-0000-0000-0000000000e2','e2@x.com');
select 'E2 levou o dia, com cópia da receita' t, d.receita_id is null as sem_vinculo, a.familia_id = p.familia_id as alimento_proprio,
       a.familia_id <> :'fam' as fora_da_casa, (select valor_por_100g from alimento_nutriente where alimento_id = a.id and nutriente_id = :'energia') as kcal_100g
  from plano_dia d join plano_dia_item di on di.plano_dia_id = d.id join alimento a on a.id = di.alimento_id
  join plano_refeicao pr on pr.id = d.plano_refeicao_id join pessoa p on p.id = pr.pessoa_id where pr.id = :'almoco2';
select 'E2 levou o treino (esperado 1)' t, count(*) from treino_plano;
select 'E2 não ve mais a receita (esperado 0)' t, count(*) from receita;

-- Alguém de fora não vê nem mexe.
select pg_temp.como('00000000-0000-0000-0000-0000000000e3','e3@x.com');
do $$ begin perform public.salvar_receita(null, 'X', '{almoco}', 100, null, '[]'); raise exception 'FALHA'; exception when raise_exception then raise notice 'ok: sem família não cria receita (%)', sqlerrm; end $$;
select public.criar_familia('Outra casa', 'E3');
select 'E3 ve receitas, dias e treinos (esperado 0)' t, (select count(*) from receita) + (select count(*) from plano_dia) + (select count(*) from treino_plano);
select 'E3 metas de E1 (esperado 0)' t, count(*) from public.metas_do_periodo(array[:'pe']::uuid[], '2026-10-25', '2026-10-31');
select set_config('t.rec', :'rec', false), set_config('t.almoco', :'almoco', false);
do $$ begin perform public.salvar_receita(current_setting('t.rec')::uuid, 'Roubada', '{almoco}', 100, null, '[{"alimento_id":"00000000-0000-0000-0000-000000000000","quantidade_g":10}]'); raise exception 'FALHA: E3 editou'; exception when raise_exception then raise notice 'ok: E3 não edita receita de fora (%)', sqlerrm; end $$;
do $$ begin perform public.definir_dias(jsonb_build_array(jsonb_build_object('plano', current_setting('t.almoco'), 'data', '2026-10-30', 'itens', '[]'::jsonb))); raise exception 'FALHA: E3 mudou o dia'; exception when raise_exception then raise notice 'ok: E3 não mexe no cardápio de fora (%)', sqlerrm; end $$;
reset role; set role anon;
do $$ begin perform public.metas_do_periodo('{}', current_date, current_date); raise exception 'FALHA: anon'; exception when insufficient_privilege then raise notice 'ok: anon não calcula metas'; end $$;
reset role;

-- Avisos: segunda 12:35 avisa com a receita do dia; terça, com o plano de sempre. Resumo usa a meta do dia.
update plano_checagem set data = data + 7 where plano_refeicao_id = :'almoco';
set role service_role;
select 'aviso seg 12:35' t, titulo, corpo from public.avisos_devidos('2026-10-26 15:35:00+00') where chave like 'refeicao:' || :'almoco' || '%';
select 'aviso ter 12:35' t, titulo, corpo from public.avisos_devidos('2026-10-27 15:35:00+00') where chave like 'refeicao:' || :'almoco' || '%';
reset role;
update plano_checagem set data = data - 7 where plano_refeicao_id = :'almoco';
set role service_role;
select 'resumo seg 21:30 (meta 1.967)' t, titulo, corpo from public.avisos_devidos('2026-10-27 00:30:00+00') where chave like 'resumo:' || :'pe' || '%';
reset role;
