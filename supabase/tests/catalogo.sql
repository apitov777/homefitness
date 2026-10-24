-- Teste do catálogo de receitas e das favoritas: rode depois de 00_stub_auth.sql e das migrations.
\set ON_ERROR_STOP 1
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000c1','c1@x.com'),
  ('00000000-0000-0000-0000-0000000000c2','c2@x.com'),
  ('00000000-0000-0000-0000-0000000000c3','c3@x.com');
create or replace function pg_temp.como(u text, e text) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claim.sub', u, false);
 perform set_config('request.jwt.claims', json_build_object('sub',u,'email',e)::text, false); end $$;

-- O catálogo: 43 receitas montadas só com ingredientes da TACO e 23 itens avulsos (o alimento da TACO, numa porção).
select 'catálogo (esperado 66 receitas, 23 avulsos, 23 sem ingredientes)' t,
  count(*) filter (where familia_id is null) as receitas,
  count(*) filter (where familia_id is null and 'avulso' = any(tags)) as avulsos,
  count(*) filter (where familia_id is null and not exists (select 1 from item_receita i where i.receita_id = receita.id)) as sem_itens
  from receita;
select 'receita da família no catálogo (esperado 0)' t, count(*) from receita where familia_id is not null;
select 'toda receita do catálogo tem energia calculada (esperado 66)' t, count(*)
  from receita r join alimento_nutriente an on an.alimento_id = r.alimento_id join nutriente n on n.id = an.nutriente_id
  where r.familia_id is null and n.codigo = 'energia' and an.valor_por_100g > 0;
select 'alimento das receitas é global e da fonte receita (esperado 43)' t, count(*)
  from receita r join alimento a on a.id = r.alimento_id
  where r.familia_id is null and a.familia_id is null and a.fonte = 'receita' and a.categoria = 'Receitas';
select 'avulso aponta direto para a TACO (esperado 23)' t, count(*)
  from receita r join alimento a on a.id = r.alimento_id
  where r.familia_id is null and 'avulso' = any(r.tags) and a.familia_id is null and a.fonte <> 'receita' and r.porcao_g = r.rendimento_g;
select 'toda receita tem porção e tipo (esperado 66)' t, count(*) from receita where familia_id is null and porcao_g > 0 and cardinality(tipos) > 0;
select 'toda receita do catálogo tem foto do app (esperado 66)' t, count(*) from receita where familia_id is null and foto like 'fotos/%.jpg';
select 'bucket de fotos privado' t, public = false as privado from storage.buckets where id = 'fotos';
select 'políticas de fotos por família (esperado 4)' t, count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'familia%fotos';
select 'nenhuma porção passa de 700 kcal (esperado 0)' t, count(*)
  from receita r join alimento_nutriente an on an.alimento_id = r.alimento_id join nutriente n on n.id = an.nutriente_id
  where r.familia_id is null and n.codigo = 'energia' and an.valor_por_100g * r.porcao_g / 100 > 700;
-- Conferência de uma receita na mão: Frango com arroz, feijão e salada (frango 150 + arroz 150 + feijão 100 + alface 30 + tomate 50 = 480 g).
select 'kcal por 100 g da receita conferida' t, round(an.valor_por_100g, 1) as calculado,
  round((select sum(x.valor_por_100g * i.quantidade_g / 100) from item_receita i join alimento_nutriente x on x.alimento_id = i.alimento_id and x.nutriente_id = n.id where i.receita_id = r.id) / r.rendimento_g * 100, 1) as esperado
  from receita r join alimento_nutriente an on an.alimento_id = r.alimento_id join nutriente n on n.id = an.nutriente_id
  where r.nome = 'Frango com arroz, feijão e salada' and n.codigo = 'energia';

-- C1 cria a família; C2 entra nela; C3 tem outra casa.
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1','c1@x.com');
select public.criar_familia('Casa catálogo', 'C1') as fam \gset
select id as p1 from pessoa where user_id = auth.uid() \gset
insert into familia_convite (familia_id, nome) values (:'fam', 'C2') returning codigo as cod \gset
select pg_temp.como('00000000-0000-0000-0000-0000000000c2','c2@x.com');
select public.aceitar_convite(:'cod') = :'fam' as entrou;
select id as p2 from pessoa where user_id = auth.uid() \gset
select pg_temp.como('00000000-0000-0000-0000-0000000000c3','c3@x.com');
select public.criar_familia('Outra casa', 'C3');
select id as p3 from pessoa where user_id = auth.uid() \gset
select 'C3 vê o catálogo inteiro (esperado 66)' t, count(*) from receita;
select 'C3 vê os ingredientes do catálogo (esperado > 100)' t, count(*) > 100 as ve from item_receita;

select pg_temp.como('00000000-0000-0000-0000-0000000000c1','c1@x.com');
select id as mousse from receita where nome = 'Sorvete de banana' \gset
select id as choc from receita where 'avulso' = any(tags) and nome ilike 'Chocolate%' limit 1 \gset
select id as frango from receita where nome = 'Frango com arroz, feijão e salada' \gset
select id as energia from nutriente where codigo = 'energia' \gset
select valor_por_100g as kcal_frango from alimento_nutriente where alimento_id = (select alimento_id from receita where id = :'frango') and nutriente_id = :'energia' \gset

-- Ninguém mexe no catálogo: update e delete não alcançam linha nenhuma; as funções recusam.
update receita set nome = 'Mudada' where id = :'frango';
select 'update no catálogo não pega (esperado 0)' t, count(*) from receita where nome = 'Mudada';
delete from receita where id = :'frango';
delete from item_receita where receita_id = :'frango';
select 'delete no catálogo não pega (esperado 66)' t, count(*) from receita where familia_id is null;
select 'ingredientes continuam (esperado 5)' t, count(*) from item_receita where receita_id = :'frango';
select set_config('t.frango', :'frango', false), set_config('t.choc', :'choc', false), set_config('t.p1', :'p1', false), set_config('t.p3', :'p3', false), set_config('t.mousse', :'mousse', false);
do $$ begin insert into item_receita (receita_id, alimento_id, quantidade_g) values (current_setting('t.frango')::uuid, (select id from alimento where nome = 'Mel, de abelha'), 50); raise exception 'FALHA: inseriu ingrediente no catálogo'; exception when insufficient_privilege or raise_exception then raise notice 'ok: não entra ingrediente no catálogo (%)', sqlerrm; end $$;
do $$ begin perform public.salvar_receita(current_setting('t.frango')::uuid, 'Minha', '{almoco}', 100, null, '[{"alimento_id":"00000000-0000-0000-0000-000000000000","quantidade_g":10}]'); raise exception 'FALHA: editou o catálogo'; exception when raise_exception then raise notice 'ok: salvar_receita não edita o catálogo (%)', sqlerrm; end $$;
do $$ begin perform public.arquivar_receita(current_setting('t.frango')::uuid); raise exception 'FALHA: arquivou o catálogo'; exception when raise_exception then raise notice 'ok: arquivar_receita recusa o catálogo (%)', sqlerrm; end $$;
do $$ begin perform public._calcular_receita(current_setting('t.frango')::uuid); raise notice 'ok: recálculo do catálogo não muda nada'; exception when insufficient_privilege or raise_exception then raise notice 'ok: recálculo do catálogo recusado (%)', sqlerrm; end $$;
select 'kcal do catálogo intactas' t, valor_por_100g = :'kcal_frango' as iguais from alimento_nutriente where alimento_id = (select alimento_id from receita where id = :'frango') and nutriente_id = :'energia';

-- Favoritas: por pessoa. C1 favorita a de frango e o chocolate; marca o sorvete de banana para C2 (mesma casa).
insert into receita_favorita (pessoa_id, receita_id) values (:'p1', :'frango'), (:'p1', :'choc'), (:'p2', :'mousse');
select 'favoritas da casa (esperado 3)' t, count(*) from receita_favorita;
select 'favoritas de C1 (esperado 2)' t, count(*) from receita_favorita where pessoa_id = :'p1';
do $$ begin insert into receita_favorita (pessoa_id, receita_id) values (current_setting('t.p3')::uuid, current_setting('t.frango')::uuid); raise exception 'FALHA: favoritou para outra casa'; exception when insufficient_privilege or raise_exception then raise notice 'ok: não favorita para pessoa de outra casa (%)', sqlerrm; end $$;
do $$ begin insert into receita_favorita (pessoa_id, receita_id) values (current_setting('t.p1')::uuid, '00000000-0000-0000-0000-000000000000'); raise exception 'FALHA: receita inexistente'; exception when foreign_key_violation or insufficient_privilege or raise_exception then raise notice 'ok: favorita de receita inexistente recusada'; end $$;
select pg_temp.como('00000000-0000-0000-0000-0000000000c2','c2@x.com');
select 'C2 vê as favoritas da casa (esperado 3)' t, count(*) from receita_favorita;
delete from receita_favorita where pessoa_id = :'p1' and receita_id = :'choc';
select 'C2 tira uma favorita de C1 (esperado 2)' t, count(*) from receita_favorita;
select pg_temp.como('00000000-0000-0000-0000-0000000000c3','c3@x.com');
select 'C3 não vê favoritas de fora (esperado 0)' t, count(*) from receita_favorita;
delete from receita_favorita;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1','c1@x.com');
select 'C3 não apagou nada (esperado 2)' t, count(*) from receita_favorita;

-- Adaptar: a cópia é da família, com porção e descrição; a do catálogo não muda.
select public.salvar_receita(null, 'Frango com arroz e salada (sem feijão)', '{almoco,jantar}', 380, 'Igual à do catálogo, sem o feijão.',
  (select jsonb_agg(jsonb_build_object('alimento_id', i.alimento_id, 'quantidade_g', i.quantidade_g)) from item_receita i join alimento a on a.id = i.alimento_id
    where i.receita_id = :'frango' and a.nome <> 'Feijão, carioca, cozido'),
  190, 'Rende 2 marmitas') as copia \gset
select 'cópia é da família, com porção e descrição' t, familia_id = :'fam' as da_familia, porcao_g, descricao, cardinality(tipos) as tipos from receita where id = :'copia';
select 'cópia tem 4 ingredientes (esperado 4)' t, count(*) from item_receita where receita_id = :'copia';
update receita set foto = :'fam' || '/' || :'copia' || '.jpg' where id = :'copia';
select 'família grava a própria foto' t, foto = :'fam' || '/' || :'copia' || '.jpg' as gravou from receita where id = :'copia';
update receita set foto = 'x' where id = :'frango';
select 'foto do catálogo não muda' t, foto from receita where id = :'frango';
select 'cópia tem energia própria' t, round(valor_por_100g, 1) > 0 as tem from alimento_nutriente where alimento_id = (select alimento_id from receita where id = :'copia') and nutriente_id = :'energia';
select 'catálogo segue com 5 ingredientes (esperado 5)' t, count(*) from item_receita where receita_id = :'frango';
select 'receitas que C1 vê (esperado 67)' t, count(*) from receita;
select public.salvar_receita(:'copia', 'Frango com arroz e salada (sem feijão)', '{almoco}', 380, null,
  (select jsonb_agg(jsonb_build_object('alimento_id', alimento_id, 'quantidade_g', quantidade_g)) from item_receita where receita_id = :'copia'));
select 'salvar sem porção limpa a porção (esperado true)' t, porcao_g is null as sem_porcao from receita where id = :'copia';
do $$ begin perform public.salvar_receita(null, 'Porção negativa', '{almoco}', 300, null, '[{"alimento_id":"00000000-0000-0000-0000-000000000000","quantidade_g":10}]', -5); raise exception 'FALHA: porção negativa'; exception when check_violation or foreign_key_violation or raise_exception then raise notice 'ok: porção negativa recusada'; end $$;

-- Favoritar a cópia e arquivá-la: a favorita some junto com a receita quando ela é apagada.
insert into receita_favorita (pessoa_id, receita_id) values (:'p1', :'copia');
select public.arquivar_receita(:'copia');
select 'arquivada sai das ativas, favorita fica até apagar (esperado false, 3)' t, (select ativa from receita where id = :'copia'), (select count(*) from receita_favorita);
delete from receita where id = :'copia';
select 'apagar a receita leva a favorita (esperado 2)' t, count(*) from receita_favorita;

-- C3, de outra casa, não vê a receita da família de C1 nem favorita para C1.
select pg_temp.como('00000000-0000-0000-0000-0000000000c3','c3@x.com');
select 'C3 só vê o catálogo (esperado 66)' t, count(*) from receita;
reset role; set role anon;
select 'anon não vê receitas (esperado 0)' t, count(*) from receita;
do $$ begin perform public.salvar_receita(null, 'X', '{almoco}', 100, null, '[]'); raise exception 'FALHA: anon'; exception when insufficient_privilege then raise notice 'ok: anon não salva receita'; end $$;
reset role;
