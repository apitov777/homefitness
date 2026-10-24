-- Teste da família (papéis, convites, entrar, sair, remover): rode depois de 00_stub_auth.sql e das migrations.
\set ON_ERROR_STOP 1
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000f1','org@x.com'),    -- organizador
  ('00000000-0000-0000-0000-0000000000f2','novo@x.com'),   -- entra pelo link, sem família
  ('00000000-0000-0000-0000-0000000000f3','solo@x.com'),   -- tem família só dele, com dependente
  ('00000000-0000-0000-0000-0000000000f4','dupla@x.com'),  -- divide família com f5
  ('00000000-0000-0000-0000-0000000000f5','par@x.com'),
  ('00000000-0000-0000-0000-0000000000f6','outro@x.com');
create or replace function pg_temp.como(u text, e text) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claim.sub', u, false);
 perform set_config('request.jwt.claims', json_build_object('sub',u,'email',e)::text, false); end $$;
set role authenticated;
select id as energia from nutriente where codigo = 'energia' \gset
select id as arroz from alimento where nome = 'Arroz, tipo 1, cozido' \gset

-- Organizador cria a família e um convite por link (sem e-mail).
select pg_temp.como('00000000-0000-0000-0000-0000000000f1','org@x.com');
select public.criar_familia('Casa', 'Org') as fam \gset
select 'papel de quem cria' t, public.meu_papel(:'fam');
do $$ begin perform public.criar_familia('Outra', 'Org'); raise exception 'FALHA: duas famílias'; exception when raise_exception then raise notice 'ok: uma família por login (%)', sqlerrm; end $$;
insert into familia_convite (familia_id, nome) values (:'fam', 'Novo') returning codigo as cod_link \gset
select 'código tem 10 caracteres' t, length(:'cod_link');
select set_config('t.cod_link', :'cod_link', false);

-- Quem abre o link sem conta vê de quem é o convite.
reset role; set role anon;
select 'anon ve o convite' t, * from public.ver_convite(lower(substr(:'cod_link', 1, 5)) || '-' || substr(:'cod_link', 6));
do $$ begin perform public.aceitar_convite('X'); raise exception 'FALHA: anon aceitou'; exception when insufficient_privilege then raise notice 'ok: anon nao aceita'; end $$;
reset role; set role authenticated;

-- f2 (sem família) aceita pelo código e ganha pessoa própria.
select pg_temp.como('00000000-0000-0000-0000-0000000000f2','novo@x.com');
select public.aceitar_convite(:'cod_link') = :'fam' as entrou;
select 'f2 papel e pessoa' t, public.meu_papel(:'fam'), (select nome from pessoa where user_id = auth.uid());
select pg_temp.como('00000000-0000-0000-0000-0000000000f6','outro@x.com');
do $$ begin perform public.aceitar_convite(current_setting('t.cod_link')); raise exception 'FALHA'; exception when raise_exception then raise notice 'ok: convite usado nao vale de novo (%)', sqlerrm; end $$;
select 'f6 ve convites da casa (esperado 0)' t, count(*) from familia_convite;

-- Adulto não convida nem adiciona dependente.
select pg_temp.como('00000000-0000-0000-0000-0000000000f2','novo@x.com');
do $$ begin insert into familia_convite (familia_id) select familia_id from familia_membro where user_id = auth.uid(); raise exception 'FALHA: adulto convidou'; exception when insufficient_privilege then raise notice 'ok: adulto nao convida'; end $$;
do $$ begin insert into pessoa (familia_id, nome) select familia_id, 'Filho' from familia_membro where user_id = auth.uid(); raise exception 'FALHA: adulto adicionou'; exception when insufficient_privilege then raise notice 'ok: adulto nao adiciona dependente'; end $$;
do $$ begin perform public.mudar_papel(auth.uid(), 'responsavel'); raise exception 'FALHA'; exception when insufficient_privilege then raise notice 'ok: adulto nao muda papel'; end $$;

-- Convite por e-mail só vale para aquele e-mail; expirado não vale.
select pg_temp.como('00000000-0000-0000-0000-0000000000f1','org@x.com');
insert into familia_convite (familia_id, email) values (:'fam', 'Solo@x.com') returning codigo as cod_solo \gset
insert into familia_convite (familia_id, email, expira_em) values (:'fam', 'velho@x.com', now() - interval '1 day') returning codigo as cod_velho \gset
select pg_temp.como('00000000-0000-0000-0000-0000000000f6','outro@x.com');
select set_config('t.cod_solo', :'cod_solo', false);
select set_config('t.cod_velho', :'cod_velho', false);
do $$ begin perform public.aceitar_convite(current_setting('t.cod_solo')); raise exception 'FALHA'; exception when raise_exception then raise notice 'ok: outro e-mail recusado (%)', sqlerrm; end $$;
do $$ begin perform public.aceitar_convite(current_setting('t.cod_velho')); raise exception 'FALHA'; exception when raise_exception then raise notice 'ok: expirado recusado (%)', sqlerrm; end $$;

-- f3 já tem família própria com dependente, alimento de rótulo e refeição. Ao aceitar, tudo vem junto.
select pg_temp.como('00000000-0000-0000-0000-0000000000f3','solo@x.com');
select public.criar_familia('Casa do Solo', 'Solo') as fam_solo \gset
insert into pessoa (familia_id, nome) values (:'fam_solo', 'Filho do Solo') returning id as filho \gset
insert into alimento (familia_id, nome, fonte) values (:'fam_solo', 'Iogurte do Solo', 'rotulo') returning id as iog \gset
insert into alimento_nutriente values (:'iog', :'energia', 80);
select public.registrar_refeicao(:'fam_solo', current_date, 'cafe', '08:00', 'Café',
  jsonb_build_array(jsonb_build_object('pessoa_id', (select id from pessoa where user_id = auth.uid()), 'itens', jsonb_build_array(jsonb_build_object('alimento_id', :'iog', 'quantidade_g', 200))))) as g_solo \gset
select 'Solo tem convite pendente' t, count(*) from public.meus_convites();
select 'aceitar_convites nao mexe em quem ja tem familia' t, public.aceitar_convites();
select public.aceitar_convite(:'cod_solo') = :'fam' as entrou;
select 'familia antiga apagada (esperado 0)' t, count(*) from familia where id = :'fam_solo';
select 'Solo ve pessoas da Casa (esperado 4)' t, count(*) from pessoa;
select 'filho veio junto' t, familia_id = :'fam' from pessoa where id = :'filho';
select 'alimento e refeicao vieram' t, (select familia_id = :'fam' from alimento where id = :'iog') alimento, (select familia_id = :'fam' from refeicao_grupo where id = :'g_solo') grupo;
select 'kcal do café continua (esperado 160)' t, kcal from v_dia_vs_meta where pessoa_id = (select id from pessoa where user_id = auth.uid());

-- f4 e f5 dividem família, com refeição feita junto e alimento próprio. f4 entra na Casa e leva só os dados dele.
select pg_temp.como('00000000-0000-0000-0000-0000000000f5','par@x.com');
select public.criar_familia('Casa da Dupla', 'Par') as fam_dupla \gset
select id as p_par from pessoa where user_id = auth.uid() \gset
insert into familia_convite (familia_id, email) values (:'fam_dupla', 'dupla@x.com');
insert into alimento (familia_id, nome, fonte) values (:'fam_dupla', 'Pão da Dupla', 'rotulo') returning id as pao \gset
insert into alimento_nutriente values (:'pao', :'energia', 250);
select pg_temp.como('00000000-0000-0000-0000-0000000000f4','dupla@x.com');
select public.aceitar_convites();
select id as p_dupla from pessoa where user_id = auth.uid() \gset
select public.registrar_refeicao(:'fam_dupla', current_date, 'almoco', '12:00', 'Almoço junto', jsonb_build_array(
  jsonb_build_object('pessoa_id', :'p_dupla', 'itens', jsonb_build_array(jsonb_build_object('alimento_id', :'pao', 'quantidade_g', 100), jsonb_build_object('alimento_id', :'arroz', 'quantidade_g', 100))),
  jsonb_build_object('pessoa_id', :'p_par', 'itens', jsonb_build_array(jsonb_build_object('alimento_id', :'pao', 'quantidade_g', 50))))) as g_dupla \gset
insert into meta (pessoa_id, kcal) values (:'p_dupla', 2100);
select pg_temp.como('00000000-0000-0000-0000-0000000000f1','org@x.com');
insert into familia_convite (familia_id, email) values (:'fam', 'dupla@x.com') returning codigo as cod_dupla \gset
select pg_temp.como('00000000-0000-0000-0000-0000000000f4','dupla@x.com');
select public.aceitar_convite(:'cod_dupla') = :'fam' as entrou;
select 'f4 na Casa, Par fica' t, (select familia_id = :'fam' from pessoa where id = :'p_dupla') f4, (select count(*) from familia_membro where familia_id = :'fam_dupla') membros_dupla;
select 'f4 ve o almoço com o pão copiado' t, count(*) itens, sum(quantidade_g) gramas, bool_and(a.familia_id = :'fam' or a.familia_id is null) alimentos_da_casa
  from item_refeicao ir join refeicao r on r.id = ir.refeicao_id join alimento a on a.id = ir.alimento_id where r.pessoa_id = :'p_dupla';
select 'kcal de f4 (pão 250 + arroz 128 = 378)' t, kcal, meta_kcal from v_dia_vs_meta where pessoa_id = :'p_dupla';
select pg_temp.como('00000000-0000-0000-0000-0000000000f5','par@x.com');
select 'Par: grupo original e pão ficam' t, (select count(*) from refeicao where refeicao_grupo_id = :'g_dupla') refeicoes_no_grupo, (select count(*) from alimento where id = :'pao') pao, (select count(*) from pessoa) pessoas;

-- Papéis: só o organizador muda; responsável convida adulto mas não responsável.
select pg_temp.como('00000000-0000-0000-0000-0000000000f1','org@x.com');
select public.mudar_papel('00000000-0000-0000-0000-0000000000f2', 'responsavel');
select public.mudar_papel('00000000-0000-0000-0000-0000000000f3', 'crianca');
select 'membros e e-mails' t, papel, email from public.membros_da_familia();
select pg_temp.como('00000000-0000-0000-0000-0000000000f2','novo@x.com');
insert into familia_convite (familia_id, papel) values (:'fam', 'adulto');
do $$ begin insert into familia_convite (familia_id, papel) select familia_id, 'responsavel' from familia_membro where user_id = auth.uid(); raise exception 'FALHA'; exception when insufficient_privilege then raise notice 'ok: responsavel nao convida responsavel'; end $$;
insert into pessoa (familia_id, nome) values (:'fam', 'Bebê') returning id as bebe \gset
delete from pessoa where id = :'bebe';
select 'responsavel apaga dependente (esperado 0)' t, count(*) from pessoa where id = :'bebe';
do $$ begin perform public.remover_membro('00000000-0000-0000-0000-0000000000f3'); raise exception 'FALHA'; exception when insufficient_privilege then raise notice 'ok: responsavel nao remove'; end $$;

-- Organizador não sai sem passar o papel; passa e aí sai levando os dados.
select pg_temp.como('00000000-0000-0000-0000-0000000000f1','org@x.com');
insert into exame (pessoa_id, data) select id, current_date from pessoa where user_id = auth.uid();
do $$ begin perform public.sair_da_familia(); raise exception 'FALHA'; exception when raise_exception then raise notice 'ok: organizador nao sai (%)', sqlerrm; end $$;
do $$ begin perform public.transferir_organizador('00000000-0000-0000-0000-0000000000f3'); raise exception 'FALHA'; exception when raise_exception then raise notice 'ok: crianca nao vira organizador'; end $$;
select public.transferir_organizador('00000000-0000-0000-0000-0000000000f2');
select 'depois de passar' t, papel, email from public.membros_da_familia();
select public.sair_da_familia() as fam_org \gset
select 'Org na família nova' t, (select nome from familia where id = :'fam_org'), public.meu_papel(:'fam_org'), (select count(*) from exame) exames, (select count(*) from pessoa) pessoas;

-- Novo organizador remove f3: f3 vai para família própria com os dados dele.
select pg_temp.como('00000000-0000-0000-0000-0000000000f2','novo@x.com');
select public.remover_membro('00000000-0000-0000-0000-0000000000f3');
select 'Casa depois de remover' t, papel, email from public.membros_da_familia();
select pg_temp.como('00000000-0000-0000-0000-0000000000f3','solo@x.com');
select 'f3 na família dele, com o café' t, (select nome from familia), (select papel from familia_membro), (select count(*) from pessoa) pessoas, (select sum(kcal) from v_dia_vs_meta) kcal;

-- Recusar convite por e-mail.
select pg_temp.como('00000000-0000-0000-0000-0000000000f2','novo@x.com');
insert into familia_convite (familia_id, email) values (:'fam', 'outro@x.com');
select pg_temp.como('00000000-0000-0000-0000-0000000000f6','outro@x.com');
select 'f6 tem convite' t, familia, convidado_por from public.meus_convites();
select public.recusar_convite((select codigo from public.meus_convites() limit 1));
select 'f6 depois de recusar (esperado 0)' t, count(*) from public.meus_convites();
