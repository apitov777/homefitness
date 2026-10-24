-- Catálogo de receitas: receitas prontas (familia_id nulo) que toda família vê, com porção sugerida,
-- descrição e etiquetas; favoritas por pessoa, que são as que entram na Semana.
-- Os valores vêm só dos ingredientes da TACO: nada é digitado à mão.
-- Item avulso (ex.: chocolate meio amargo, 30 g): receita sem ingredientes, cujo alimento é o próprio da TACO.

alter table public.receita alter column familia_id drop not null;
alter table public.receita
  add column descricao text,
  add column porcao_g numeric check (porcao_g > 0),
  add column tags text[] not null default '{}';
create index on public.receita (familia_id);

-- Catálogo: leitura para quem está logado; escrita só na receita da própria família.
drop policy "membro gerencia" on public.receita;
create policy "le catalogo e da familia" on public.receita for select to authenticated
  using (familia_id is null or public.eh_membro(familia_id));
create policy "familia insere" on public.receita for insert to authenticated
  with check (familia_id is not null and public.eh_membro(familia_id));
create policy "familia edita" on public.receita for update to authenticated
  using (familia_id is not null and public.eh_membro(familia_id))
  with check (familia_id is not null and public.eh_membro(familia_id));
create policy "familia apaga" on public.receita for delete to authenticated
  using (familia_id is not null and public.eh_membro(familia_id));

drop policy "segue a receita" on public.item_receita;
create policy "le catalogo e da familia" on public.item_receita for select to authenticated
  using (exists (select 1 from public.receita r where r.id = receita_id and (r.familia_id is null or public.eh_membro(r.familia_id))));
create policy "familia insere" on public.item_receita for insert to authenticated
  with check (exists (select 1 from public.receita r where r.id = receita_id and r.familia_id is not null and public.eh_membro(r.familia_id)));
create policy "familia edita" on public.item_receita for update to authenticated
  using (exists (select 1 from public.receita r where r.id = receita_id and r.familia_id is not null and public.eh_membro(r.familia_id)))
  with check (exists (select 1 from public.receita r where r.id = receita_id and r.familia_id is not null and public.eh_membro(r.familia_id)));
create policy "familia apaga" on public.item_receita for delete to authenticated
  using (exists (select 1 from public.receita r where r.id = receita_id and r.familia_id is not null and public.eh_membro(r.familia_id)));

-- Favoritas: por pessoa. São as receitas que a Semana oferece para montar o cardápio.
create table public.receita_favorita (
  pessoa_id uuid not null references public.pessoa(id) on delete cascade,
  receita_id uuid not null references public.receita(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (pessoa_id, receita_id)
);
create index on public.receita_favorita (receita_id);
alter table public.receita_favorita enable row level security;
create policy "familia gerencia" on public.receita_favorita for all to authenticated
  using (public.pessoa_da_minha_familia(pessoa_id))
  with check (public.pessoa_da_minha_familia(pessoa_id) and exists (select 1 from public.receita r where r.id = receita_id));

-- ---------------------------------------------------------------------------
-- Cálculo da receita (usado ao salvar e ao semear o catálogo)
-- ---------------------------------------------------------------------------

-- Valor por 100 g do alimento da receita = soma(valor por 100 g do ingrediente × g / 100) ÷ peso pronto × 100.
create or replace function public._calcular_receita(p_receita uuid)
returns void language sql security invoker set search_path = '' as $$
  delete from public.alimento_nutriente
    where alimento_id = (select alimento_id from public.receita where id = p_receita);
  insert into public.alimento_nutriente (alimento_id, nutriente_id, valor_por_100g)
    select r.alimento_id, an.nutriente_id, round(sum(an.valor_por_100g * ir.quantidade_g / 100) / r.rendimento_g * 100, 4)
    from public.receita r
    join public.item_receita ir on ir.receita_id = r.id
    join public.alimento_nutriente an on an.alimento_id = ir.alimento_id
    where r.id = p_receita
    group by r.alimento_id, an.nutriente_id, r.rendimento_g;
$$;

drop function public.salvar_receita(uuid, text, text[], numeric, text, jsonb);
create or replace function public.salvar_receita(
  p_id uuid, p_nome text, p_tipos text[], p_rendimento_g numeric, p_modo_preparo text, p_itens jsonb,
  p_porcao_g numeric default null, p_descricao text default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_familia uuid := (select familia_id from public.familia_membro where user_id = (select auth.uid()));
  v_receita uuid := p_id;
  v_alimento uuid;
  v_antigo uuid;
  it jsonb;
begin
  if v_familia is null then raise exception 'entre em uma família primeiro'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'dê um nome para a receita'; end if;
  if coalesce(p_rendimento_g, 0) <= 0 then raise exception 'informe o peso da receita pronta'; end if;
  if jsonb_array_length(coalesce(p_itens, '[]'::jsonb)) = 0 then raise exception 'a receita precisa de ingredientes'; end if;

  if v_receita is null then
    insert into public.alimento (familia_id, nome, categoria, fonte)
      values (v_familia, trim(p_nome), 'Receitas da família', 'receita') returning id into v_alimento;
    insert into public.receita (familia_id, alimento_id, nome, rendimento_g, modo_preparo, tipos, porcao_g, descricao)
      values (v_familia, v_alimento, trim(p_nome), p_rendimento_g, nullif(trim(p_modo_preparo), ''), p_tipos, p_porcao_g, nullif(trim(p_descricao), ''))
      returning id into v_receita;
  else
    -- Só a receita da própria família; as do catálogo se copiam (p_id nulo) em vez de editar.
    select alimento_id into v_antigo from public.receita where id = v_receita and familia_id = v_familia;
    if not found then raise exception 'receita não encontrada'; end if;
    if exists (select 1 from public.item_refeicao where alimento_id = v_antigo) then
      insert into public.alimento (familia_id, nome, categoria, fonte)
        values (v_familia, trim(p_nome), 'Receitas da família', 'receita') returning id into v_alimento;
      update public.alimento set ativo = false where id = v_antigo;
      update public.plano_item set alimento_id = v_alimento where alimento_id = v_antigo;
      update public.plano_dia_item set alimento_id = v_alimento where alimento_id = v_antigo;
    else
      v_alimento := v_antigo;
      update public.alimento set nome = trim(p_nome) where id = v_alimento;
    end if;
    update public.receita
      set alimento_id = v_alimento, nome = trim(p_nome), rendimento_g = p_rendimento_g,
          modo_preparo = nullif(trim(p_modo_preparo), ''), tipos = p_tipos, ativa = true,
          porcao_g = p_porcao_g, descricao = nullif(trim(p_descricao), '')
      where id = v_receita;
  end if;

  delete from public.item_receita where receita_id = v_receita;
  for it in select * from jsonb_array_elements(p_itens) loop
    if coalesce((it ->> 'quantidade_g')::numeric, 0) > 0 then
      insert into public.item_receita (receita_id, alimento_id, quantidade_g)
        values (v_receita, (it ->> 'alimento_id')::uuid, (it ->> 'quantidade_g')::numeric);
    end if;
  end loop;
  perform public._calcular_receita(v_receita);
  return v_receita;
end $$;

create or replace function public.arquivar_receita(p_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from public.receita r where r.id = p_id and r.familia_id is not null and public.eh_membro(r.familia_id)) then
    raise exception 'só dá para arquivar receita da própria família';
  end if;
  update public.alimento set ativo = false where id = (select alimento_id from public.receita where id = p_id);
  update public.receita set ativa = false where id = p_id;
end $$;

revoke execute on function
  public.salvar_receita(uuid, text, text[], numeric, text, jsonb, numeric, text), public.arquivar_receita(uuid), public._calcular_receita(uuid)
  from public, anon;
grant execute on function
  public.salvar_receita(uuid, text, text[], numeric, text, jsonb, numeric, text), public.arquivar_receita(uuid), public._calcular_receita(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------

-- Cada receita: nome, descrição, tipos de refeição, etiquetas, peso pronto, porção, preparo e ingredientes [nome TACO, g].
-- Peso pronto considera a água que entra ou sai no cozimento; a porção é a sugerida para uma pessoa.
do $$
declare
  r jsonb;
  it jsonb;
  v_al uuid;
  v_ing uuid;
  v_rec uuid;
  receitas jsonb := $j$[
    {"n":"Panqueca de banana e aveia","d":"Sem farinha nem açúcar: banana, ovo e aveia. Dá 3 panquecas médias.","t":["cafe","lanche_manha","lanche_tarde"],"g":["fitness","rápido","doce"],"r":220,"p":220,
     "m":"Amasse a banana com um garfo. Misture os ovos e a aveia até virar uma massa grossa. Em frigideira antiaderente untada com um fio de azeite, despeje conchas pequenas e doure 2 minutos de cada lado em fogo baixo.",
     "i":[["Banana, prata, crua",100],["Ovo, de galinha, inteiro, cru",100],["Aveia, flocos, crua",40]]},
    {"n":"Omelete de legumes com queijo minas","d":"Três ovos, tomate, cebola e queijo minas. Café da manhã ou jantar leve.","t":["cafe","jantar","ceia"],"g":["fitness","proteico","rápido","vegetariano"],"r":230,"p":230,
     "m":"Bata os ovos com sal e pimenta. Refogue a cebola no azeite, junte o tomate picado, despeje os ovos e espalhe o queijo em cubos. Tampe em fogo baixo até firmar e dobre ao meio.",
     "i":[["Ovo, de galinha, inteiro, cru",150],["Tomate, salada",50],["Cebola, crua",20],["Queijo, minas, frescal",30],["Azeite, de oliva, extra virgem",5]]},
    {"n":"Mingau de aveia com banana","d":"Aveia cozida no leite desnatado, com banana e um fio de mel. Rende uma tigela grande.","t":["cafe","ceia"],"g":["fitness","fibra","doce"],"r":380,"p":380,
     "m":"Dissolva o leite em pó em 250 mL de água. Leve ao fogo com a aveia, mexendo, por 5 minutos até engrossar. Sirva com a banana em rodelas e o mel.",
     "i":[["Aveia, flocos, crua",40],["Leite, de vaca, desnatado, pó",25],["Banana, prata, crua",80],["Mel, de abelha",10]]},
    {"n":"Iogurte com morango e aveia","d":"Iogurte natural desnatado, morangos, aveia e mel.","t":["cafe","lanche_manha","lanche_tarde","ceia"],"g":["fitness","rápido","doce","vegetariano"],"r":280,"p":280,
     "m":"Coloque o iogurte na tigela, cubra com os morangos picados, a aveia e o mel.",
     "i":[["Iogurte, natural, desnatado",170],["Morango, cru",80],["Aveia, flocos, crua",20],["Mel, de abelha",10]]},
    {"n":"Pão integral com ovo mexido e tomate","d":"Duas fatias de pão integral, dois ovos mexidos e tomate.","t":["cafe","lanche_tarde"],"g":["fitness","proteico","rápido"],"r":190,"p":190,
     "m":"Mexa os ovos em fogo baixo com um fio de azeite até ficarem cremosos. Sirva sobre o pão com o tomate em rodelas e orégano.",
     "i":[["Pão, trigo, forma, integral",50],["Ovo, de galinha, inteiro, cru",100],["Tomate, salada",50],["Azeite, de oliva, extra virgem",3]]},
    {"n":"Vitamina de banana com aveia","d":"Leite desnatado, banana e aveia batidos. Um copo grande.","t":["cafe","lanche_manha","pos_treino"],"g":["fitness","rápido","doce"],"r":340,"p":340,
     "m":"Bata no liquidificador o leite em pó com 200 mL de água gelada, a banana e a aveia. Canela a gosto.",
     "i":[["Leite, de vaca, desnatado, pó",20],["Banana, nanica, crua",100],["Aveia, flocos, crua",20]]},
    {"n":"Tapioca com queijo e ovo","d":"Goma de polvilho doce com queijo minas e ovo. Uma tapioca grande.","t":["cafe","lanche_tarde","jantar"],"g":["fitness","rápido","sem glúten"],"r":140,"p":140,
     "m":"Hidrate o polvilho com água aos poucos até ficar granulado, peneire e espalhe numa frigideira quente. Quando firmar, vire, recheie com o queijo e o ovo mexido e dobre.",
     "i":[["Polvilho, doce",40],["Queijo, minas, frescal",30],["Ovo, de galinha, inteiro, cru",50]]},
    {"n":"Crepioca de frango","d":"Massa de ovo e polvilho, recheada com frango desfiado e tomate.","t":["cafe","lanche_tarde","jantar","pos_treino"],"g":["fitness","proteico","rápido","sem glúten"],"r":150,"p":150,
     "m":"Misture o ovo com o polvilho e uma pitada de sal. Espalhe na frigideira antiaderente quente, vire quando soltar, recheie com o frango desfiado e o tomate e dobre.",
     "i":[["Ovo, de galinha, inteiro, cru",50],["Polvilho, doce",20],["Frango, peito, sem pele, cozido",60],["Tomate, salada",30]]},
    {"n":"Ovos mexidos com couve","d":"Três ovos mexidos com couve picada no azeite.","t":["cafe","jantar","ceia"],"g":["fitness","proteico","rápido","vegetariano"],"r":180,"p":180,
     "m":"Refogue a couve picada no azeite por 1 minuto, junte os ovos batidos e mexa em fogo baixo até firmar.",
     "i":[["Ovo, de galinha, inteiro, cru",150],["Couve, manteiga, crua",50],["Azeite, de oliva, extra virgem",5]]},
    {"n":"Salada de frutas","d":"Banana, mamão, maçã, laranja e morango. Uma tigela grande.","t":["cafe","lanche_manha","lanche_tarde","ceia"],"g":["doce","fibra","rápido","vegetariano"],"r":390,"p":390,
     "m":"Pique tudo em cubos, misture e regue com o suco da laranja para não escurecer.",
     "i":[["Banana, prata, crua",80],["Mamão, Papaia, cru",100],["Maçã, Fuji, com casca, crua",80],["Laranja, pêra, crua",80],["Morango, cru",50]]},

    {"n":"Frango grelhado com batata-doce e brócolis","d":"O prato fitness clássico: peito de frango, batata-doce e brócolis no vapor.","t":["almoco","jantar","pos_treino"],"g":["fitness","proteico"],"r":455,"p":455,
     "m":"Tempere o frango com sal, alho e limão e grelhe 5 minutos de cada lado. Cozinhe a batata-doce em cubos por 15 minutos e o brócolis no vapor por 5. Regue com o azeite.",
     "i":[["Frango, peito, sem pele, grelhado",150],["Batata, doce, cozida",200],["Brócolis, cozido",100],["Azeite, de oliva, extra virgem",5]]},
    {"n":"Salmão grelhado com legumes","d":"Salmão na frigideira com abobrinha e cenoura. Fonte de ômega-3.","t":["almoco","jantar"],"g":["fitness","proteico","ômega-3"],"r":335,"p":335,
     "m":"Grelhe o salmão com sal e limão, 4 minutos de cada lado. Salteie a abobrinha e a cenoura em rodelas no azeite por 6 minutos.",
     "i":[["Salmão, sem pele, fresco, grelhado",150],["Abobrinha, italiana, cozida",100],["Cenoura, cozida",80],["Azeite, de oliva, extra virgem",5]]},
    {"n":"Patinho grelhado com arroz integral e feijão","d":"Bife de patinho, arroz integral, feijão carioca e couve refogada.","t":["almoco","jantar"],"g":["fitness","proteico","fibra"],"r":440,"p":440,
     "m":"Grelhe o bife em frigideira bem quente, 3 minutos de cada lado. Sirva com o arroz integral, o feijão e a couve refogada no alho.",
     "i":[["Carne, bovina, patinho, sem gordura, grelhado",150],["Arroz, integral, cozido",150],["Feijão, carioca, cozido",100],["Couve, manteiga, refogada",40]]},
    {"n":"Frango com arroz, feijão e salada","d":"Peito de frango grelhado, arroz, feijão, alface e tomate.","t":["almoco","jantar"],"g":["fitness","proteico"],"r":480,"p":480,
     "m":"Grelhe o frango temperado com sal, alho e limão. Monte o prato com o arroz, o feijão e a salada de alface e tomate com um fio de azeite.",
     "i":[["Frango, peito, sem pele, grelhado",150],["Arroz, tipo 1, cozido",150],["Feijão, carioca, cozido",100],["Alface, crespa, crua",30],["Tomate, salada",50]]},
    {"n":"Escondidinho de frango com mandioca","d":"Purê de mandioca com frango desfiado refogado e queijo minas gratinado. Rende 3 porções.","t":["almoco","jantar"],"g":["fitness","proteico","forno"],"r":850,"p":300,
     "m":"Amasse a mandioca cozida com um pouco da água do cozimento e sal. Refogue a cebola no azeite, junte o frango desfiado e o purê de tomate e cozinhe 5 minutos. Monte numa travessa: metade do purê, o frango, o resto do purê e o queijo por cima. Forno a 200 °C por 20 minutos.",
     "i":[["Mandioca, cozida",400],["Frango, peito, sem pele, cozido",300],["Cebola, crua",50],["Tomate, purê",100],["Azeite, de oliva, extra virgem",10],["Queijo, minas, frescal",50]]},
    {"n":"Carne moída com abóbora","d":"Acém moído refogado com abóbora cabotian em cubos. Rende 2 porções.","t":["almoco","jantar"],"g":["fitness","proteico"],"r":600,"p":300,
     "m":"Doure a cebola e o alho no azeite, junte a carne moída e refogue até soltar a água. Acrescente o purê de tomate e a abóbora em cubos, tampe e cozinhe 15 minutos em fogo baixo.",
     "i":[["Carne, bovina, acém, moído, cozido",200],["Abóbora, cabotian, cozida",300],["Cebola, crua",40],["Alho, cru",5],["Tomate, purê",100],["Azeite, de oliva, extra virgem",10]]},
    {"n":"Merluza assada com batata e cenoura","d":"Filé de merluza no forno com batata e cenoura.","t":["almoco","jantar"],"g":["fitness","proteico","forno"],"r":385,"p":385,
     "m":"Tempere a merluza com sal, limão e alho. Numa assadeira, coloque a batata e a cenoura em rodelas, o peixe por cima e o azeite. Forno a 200 °C por 25 minutos.",
     "i":[["Merluza, filé, assado",150],["Batata, inglesa, cozida",150],["Cenoura, cozida",80],["Azeite, de oliva, extra virgem",5]]},
    {"n":"Omelete de forno com espinafre e ricota","d":"Seis ovos, espinafre, ricota, cebola e tomate assados. Rende 2 porções.","t":["almoco","jantar","cafe"],"g":["fitness","proteico","forno","vegetariano"],"r":560,"p":280,
     "m":"Bata os ovos com sal. Misture o espinafre refogado, a ricota esfarelada, a cebola e o tomate picados. Despeje numa forma untada e asse a 180 °C por 25 minutos.",
     "i":[["Ovo, de galinha, inteiro, cru",300],["Espinafre, Nova Zelândia, refogado",100],["Queijo, ricota",100],["Cebola, crua",40],["Tomate, salada",80]]},
    {"n":"Macarrão com frango e brócolis","d":"Macarrão com tiras de frango grelhado, brócolis e alho no azeite.","t":["almoco","jantar"],"g":["fitness","proteico"],"r":400,"p":400,
     "m":"Cozinhe o macarrão em água com sal. Grelhe o frango em tiras. Doure o alho no azeite, junte o brócolis e o frango, misture o macarrão escorrido.",
     "i":[["Macarrão, trigo, cru",80],["Frango, peito, sem pele, grelhado",120],["Brócolis, cozido",100],["Azeite, de oliva, extra virgem",8],["Alho, cru",5]]},
    {"n":"Sopa de legumes com frango","d":"Frango desfiado com batata, cenoura, abobrinha e cebola. Rende 2 pratos fundos.","t":["jantar","ceia"],"g":["fitness","leve"],"r":1000,"p":500,
     "m":"Refogue a cebola no azeite, junte 600 mL de água, o frango e os legumes em cubos. Cozinhe 20 minutos, desfie o frango e acerte o sal. Salsinha por cima.",
     "i":[["Frango, peito, sem pele, cozido",150],["Batata, inglesa, cozida",150],["Cenoura, cozida",100],["Abobrinha, italiana, cozida",100],["Cebola, crua",40],["Azeite, de oliva, extra virgem",5]]},
    {"n":"Salada de atum com grão-de-bico","d":"Atum, grão-de-bico, tomate, cebola e rúcula com azeite.","t":["almoco","jantar"],"g":["fitness","proteico","fibra","rápido"],"r":400,"p":400,
     "m":"Deixe o grão-de-bico de molho de véspera e cozinhe 40 minutos na pressão. Misture com o atum escorrido, o tomate e a cebola picados, a rúcula, o azeite, limão e sal.",
     "i":[["Atum, conserva em óleo",120],["Grão-de-bico, cru",60],["Tomate, salada",80],["Cebola, crua",20],["Azeite, de oliva, extra virgem",5],["Rúcula, crua",30]]},
    {"n":"Strogonoff de frango fit","d":"Frango em cubos com iogurte natural no lugar do creme de leite. Rende 2 porções; sirva com arroz.","t":["almoco","jantar"],"g":["fitness","proteico"],"r":380,"p":190,
     "m":"Doure o frango em cubos no azeite, junte a cebola e refogue. Acrescente o purê de tomate, cozinhe 5 minutos, desligue o fogo e misture o iogurte.",
     "i":[["Frango, peito, sem pele, cozido",200],["Iogurte, natural, desnatado",100],["Tomate, purê",50],["Cebola, crua",40],["Azeite, de oliva, extra virgem",5]]},
    {"n":"Lentilha com legumes","d":"Lentilha cozida com cenoura, tomate, cebola e alho. Proteína vegetal e ferro.","t":["almoco","jantar"],"g":["fitness","vegetariano","fibra"],"r":360,"p":360,
     "m":"Refogue a cebola e o alho no azeite, junte a cenoura em cubos e o tomate. Acrescente a lentilha cozida e um pouco de água, cozinhe 10 minutos.",
     "i":[["Lentilha, cozida",200],["Cenoura, cozida",60],["Cebola, crua",30],["Tomate, salada",60],["Azeite, de oliva, extra virgem",5],["Alho, cru",5]]},
    {"n":"Tofu grelhado com legumes","d":"Fatias de tofu douradas com brócolis e cenoura.","t":["almoco","jantar"],"g":["fitness","vegetariano","proteico"],"r":310,"p":310,
     "m":"Seque o tofu, corte em fatias e doure no azeite com shoyu. Salteie o brócolis e a cenoura.",
     "i":[["Soja, queijo (tofu)",150],["Brócolis, cozido",100],["Cenoura, cozida",60],["Azeite, de oliva, extra virgem",5]]},
    {"n":"Sardinha assada com batata","d":"Sardinhas frescas no forno com batata, tomate e cebola. Ômega-3 e cálcio.","t":["almoco","jantar"],"g":["fitness","ômega-3","forno"],"r":395,"p":395,
     "m":"Numa assadeira, coloque a batata em rodelas, a cebola e o tomate, as sardinhas temperadas com sal e limão, e o azeite. Forno a 200 °C por 25 minutos.",
     "i":[["Sardinha, assada",150],["Batata, inglesa, cozida",150],["Tomate, salada",60],["Cebola, crua",30],["Azeite, de oliva, extra virgem",5]]},

    {"n":"Mix de castanhas","d":"Castanha-do-Brasil, castanha-de-caju e amendoim. Um punhado.","t":["lanche_manha","lanche_tarde","ceia"],"g":["lanche","rápido","vegetariano"],"r":40,"p":40,
     "m":"Misture e guarde em pote fechado. Um punhado de 40 g por vez.",
     "i":[["Castanha-do-Brasil, crua",10],["Castanha-de-caju, torrada, salgada",15],["Amendoim, torrado, salgado",15]]},
    {"n":"Sanduíche natural de frango","d":"Pão integral com frango desfiado, ricota, alface e tomate.","t":["lanche_manha","lanche_tarde","jantar","ceia"],"g":["fitness","proteico","rápido"],"r":190,"p":190,
     "m":"Misture o frango desfiado com a ricota amassada, sal e limão. Monte o sanduíche com a alface e o tomate.",
     "i":[["Pão, trigo, forma, integral",50],["Frango, peito, sem pele, cozido",60],["Queijo, ricota",30],["Alface, crespa, crua",20],["Tomate, salada",30]]},
    {"n":"Sanduíche de peru com ricota","d":"Pão integral com peito de peru, ricota, alface e tomate.","t":["lanche_manha","lanche_tarde","ceia"],"g":["fitness","proteico","rápido"],"r":180,"p":180,
     "m":"Passe a ricota no pão, monte com o peru, a alface e o tomate.",
     "i":[["Pão, trigo, forma, integral",50],["Peru, congelado, assado",50],["Queijo, ricota",30],["Alface, crespa, crua",20],["Tomate, salada",30]]},
    {"n":"Iogurte com banana e linhaça","d":"Iogurte natural desnatado com banana e linhaça.","t":["cafe","lanche_manha","lanche_tarde","ceia"],"g":["fitness","rápido","fibra","vegetariano"],"r":250,"p":250,
     "m":"Corte a banana em rodelas sobre o iogurte e salpique a linhaça.",
     "i":[["Iogurte, natural, desnatado",170],["Banana, prata, crua",70],["Linhaça, semente",10]]},
    {"n":"Banana com aveia e mel","d":"Banana em rodelas com aveia e mel. Lanche rápido antes do treino.","t":["lanche_manha","lanche_tarde","pre_treino"],"g":["rápido","doce","vegetariano"],"r":125,"p":125,
     "m":"Corte a banana, salpique a aveia e regue com o mel. Canela a gosto.",
     "i":[["Banana, prata, crua",100],["Aveia, flocos, crua",15],["Mel, de abelha",10]]},
    {"n":"Ovos cozidos com tomate","d":"Dois ovos cozidos e tomate com sal e orégano.","t":["lanche_tarde","pos_treino","ceia"],"g":["fitness","proteico","rápido"],"r":160,"p":160,
     "m":"Cozinhe os ovos por 10 minutos. Sirva com o tomate em rodelas, sal e orégano.",
     "i":[["Ovo, de galinha, inteiro, cozido/10minutos",100],["Tomate, salada",60]]},
    {"n":"Abacate com mel e chocolate","d":"Abacate amassado com mel e raspas de chocolate meio amargo.","t":["lanche_tarde","ceia"],"g":["doce","rápido","vegetariano"],"r":120,"p":120,
     "m":"Amasse o abacate com o mel e salpique o chocolate ralado.",
     "i":[["Abacate, cru",100],["Mel, de abelha",10],["Chocolate, meio amargo",10]]},

    {"n":"Bolo de banana com aveia","d":"Sem farinha nem açúcar: banana, ovo, aveia e mel. Rende 8 fatias.","t":["cafe","lanche_manha","lanche_tarde"],"g":["doce","forno","fibra","vegetariano"],"r":600,"p":75,
     "m":"Bata no liquidificador a banana, os ovos, o mel e o azeite. Misture a aveia e 1 colher de fermento. Forma untada, forno a 180 °C por 35 minutos.",
     "i":[["Banana, nanica, crua",300],["Ovo, de galinha, inteiro, cru",150],["Aveia, flocos, crua",150],["Mel, de abelha",60],["Azeite, de oliva, extra virgem",20]]},
    {"n":"Cookie de banana e aveia","d":"Só banana, aveia e gotas de chocolate meio amargo. Rende 5 cookies.","t":["lanche_manha","lanche_tarde","ceia"],"g":["doce","forno","vegetariano"],"r":190,"p":40,
     "m":"Amasse a banana, misture a aveia e o chocolate picado. Faça bolinhas achatadas numa assadeira com papel-manteiga. Forno a 180 °C por 15 minutos.",
     "i":[["Banana, nanica, crua",120],["Aveia, flocos, crua",80],["Chocolate, meio amargo",20]]},
    {"n":"Brownie de chocolate meio amargo","d":"Chocolate meio amargo, banana, ovo e aveia. Rende 6 pedaços.","t":["lanche_tarde","ceia"],"g":["doce","forno","vegetariano"],"r":330,"p":55,
     "m":"Derreta o chocolate em banho-maria. Bata a banana com os ovos, junte o chocolate e a aveia. Forma pequena untada, forno a 180 °C por 20 minutos.",
     "i":[["Chocolate, meio amargo",80],["Banana, nanica, crua",150],["Ovo, de galinha, inteiro, cru",100],["Aveia, flocos, crua",40]]},
    {"n":"Doce de banana sem açúcar","d":"Banana cozida até virar doce, só com limão. Rende 4 porções.","t":["lanche_tarde","ceia"],"g":["doce","vegetariano"],"r":250,"p":60,
     "m":"Corte as bananas em rodelas e leve ao fogo baixo com o suco de limão, mexendo, por 25 minutos, até escurecer e engrossar.",
     "i":[["Banana, nanica, crua",400],["Limão, tahiti, cru",10]]},
    {"n":"Creme de maracujá com iogurte","d":"Iogurte natural batido com polpa de maracujá e mel. Rende 2 taças.","t":["lanche_tarde","ceia"],"g":["doce","rápido","vegetariano"],"r":320,"p":160,
     "m":"Bata o iogurte com a polpa e o mel. Leve à geladeira por 2 horas.",
     "i":[["Iogurte, natural",200],["Maracujá, polpa, congelada",100],["Mel, de abelha",20]]},
    {"n":"Picolé de manga com iogurte","d":"Manga batida com iogurte natural, congelada. Rende 4 picolés.","t":["lanche_tarde","ceia"],"g":["doce","vegetariano"],"r":300,"p":75,
     "m":"Bata a manga com o iogurte, distribua em forminhas de picolé e congele por 6 horas.",
     "i":[["Manga, Palmer, crua",200],["Iogurte, natural, desnatado",100]]},
    {"n":"Maçã assada com mel e aveia","d":"Maçã no forno com mel e aveia por cima.","t":["lanche_tarde","ceia","cafe"],"g":["doce","forno","vegetariano"],"r":160,"p":160,
     "m":"Corte a maçã ao meio, retire as sementes, regue com o mel e cubra com a aveia. Forno a 180 °C por 20 minutos. Canela a gosto.",
     "i":[["Maçã, Fuji, com casca, crua",150],["Mel, de abelha",10],["Aveia, flocos, crua",10]]},
    {"n":"Morangos com chocolate meio amargo","d":"Morangos banhados em chocolate meio amargo derretido.","t":["lanche_tarde","ceia"],"g":["doce","rápido","vegetariano"],"r":175,"p":175,
     "m":"Derreta o chocolate em banho-maria, banhe os morangos e deixe firmar na geladeira por 20 minutos.",
     "i":[["Morango, cru",150],["Chocolate, meio amargo",25]]},
    {"n":"Aveia de geladeira com morango","d":"Aveia hidratada no iogurte de um dia para o outro, com morango, mel e linhaça.","t":["cafe","lanche_manha","ceia"],"g":["fitness","fibra","doce","vegetariano"],"r":285,"p":285,
     "m":"Misture a aveia, o iogurte, o mel e a linhaça num pote e deixe na geladeira de um dia para o outro. Sirva com os morangos.",
     "i":[["Aveia, flocos, crua",40],["Iogurte, natural, desnatado",150],["Morango, cru",80],["Mel, de abelha",10],["Linhaça, semente",5]]},
    {"n":"Pasta de amendoim caseira","d":"Só amendoim torrado e batido. Uma colher de sopa por vez.","t":["cafe","lanche_manha","lanche_tarde","pre_treino"],"g":["lanche","vegetariano"],"r":190,"p":20,
     "m":"Toste o amendoim cru no forno a 180 °C por 12 minutos. Bata no processador por 5 a 8 minutos, parando para raspar, até virar pasta.",
     "i":[["Amendoim, grão, cru",200]]},
    {"n":"Sorvete de banana","d":"Banana congelada batida, com raspas de chocolate meio amargo. Rende 2 taças.","t":["lanche_tarde","ceia"],"g":["doce","rápido","vegetariano"],"r":210,"p":105,
     "m":"Congele a banana em rodelas por 4 horas. Bata no processador até ficar cremoso e sirva com o chocolate ralado.",
     "i":[["Banana, nanica, crua",200],["Chocolate, meio amargo",10]]}
  ]$j$;
  avulsos jsonb := $j$[
    {"n":"Chocolate meio amargo, 30 g","d":"Três quadradinhos. Prefira 70% de cacau.","t":["lanche_tarde","ceia"],"g":["avulso","doce"],"p":30,"a":"Chocolate, meio amargo"},
    {"n":"Castanha-do-Brasil, 2 unidades","d":"Duas castanhas (10 g) cobrem o selênio do dia.","t":["lanche_manha","lanche_tarde"],"g":["avulso"],"p":10,"a":"Castanha-do-Brasil, crua"},
    {"n":"Castanha-de-caju, 30 g","d":"Um punhado.","t":["lanche_manha","lanche_tarde","ceia"],"g":["avulso"],"p":30,"a":"Castanha-de-caju, torrada, salgada"},
    {"n":"Amendoim torrado, 30 g","d":"Um punhado.","t":["lanche_manha","lanche_tarde","ceia"],"g":["avulso"],"p":30,"a":"Amendoim, torrado, salgado"},
    {"n":"Ovo cozido, 1 unidade","d":"Um ovo (50 g).","t":["cafe","lanche_manha","lanche_tarde","pos_treino","ceia"],"g":["avulso","proteico"],"p":50,"a":"Ovo, de galinha, inteiro, cozido/10minutos"},
    {"n":"Banana prata, 1 unidade","d":"Uma banana média (70 g).","t":["cafe","lanche_manha","lanche_tarde","pre_treino"],"g":["avulso","doce"],"p":70,"a":"Banana, prata, crua"},
    {"n":"Maçã, 1 unidade","d":"Uma maçã média com casca (150 g).","t":["lanche_manha","lanche_tarde","ceia"],"g":["avulso","doce"],"p":150,"a":"Maçã, Fuji, com casca, crua"},
    {"n":"Laranja, 1 unidade","d":"Uma laranja pêra (130 g).","t":["cafe","lanche_manha","lanche_tarde"],"g":["avulso","doce"],"p":130,"a":"Laranja, pêra, crua"},
    {"n":"Mamão papaia, metade","d":"Meio mamão papaia (150 g).","t":["cafe","lanche_manha","ceia"],"g":["avulso","doce"],"p":150,"a":"Mamão, Papaia, cru"},
    {"n":"Morangos, 1 xícara","d":"Uma xícara de morangos (150 g).","t":["cafe","lanche_manha","lanche_tarde","ceia"],"g":["avulso","doce"],"p":150,"a":"Morango, cru"},
    {"n":"Uva, 1 cacho pequeno","d":"Um cacho pequeno (100 g).","t":["lanche_manha","lanche_tarde","ceia"],"g":["avulso","doce"],"p":100,"a":"Uva, Itália, crua"},
    {"n":"Abacate, 100 g","d":"Meio abacate pequeno.","t":["cafe","lanche_tarde","ceia"],"g":["avulso"],"p":100,"a":"Abacate, cru"},
    {"n":"Iogurte natural desnatado, 1 pote","d":"Um pote (170 g).","t":["cafe","lanche_manha","lanche_tarde","ceia"],"g":["avulso","proteico"],"p":170,"a":"Iogurte, natural, desnatado"},
    {"n":"Queijo minas frescal, 1 fatia","d":"Uma fatia (30 g).","t":["cafe","lanche_tarde","ceia"],"g":["avulso","proteico"],"p":30,"a":"Queijo, minas, frescal"},
    {"n":"Ricota, 50 g","d":"Duas colheres de sopa cheias.","t":["cafe","lanche_tarde","ceia"],"g":["avulso","proteico"],"p":50,"a":"Queijo, ricota"},
    {"n":"Mel, 1 colher de sopa","d":"Uma colher de sopa (20 g).","t":["cafe","pre_treino"],"g":["avulso","doce"],"p":20,"a":"Mel, de abelha"},
    {"n":"Linhaça, 1 colher de sopa","d":"Uma colher de sopa (10 g) de semente.","t":["cafe","lanche_manha"],"g":["avulso","fibra"],"p":10,"a":"Linhaça, semente"},
    {"n":"Batata-doce cozida, 150 g","d":"Uma batata-doce média cozida.","t":["pre_treino","pos_treino","almoco","jantar"],"g":["avulso","fitness"],"p":150,"a":"Batata, doce, cozida"},
    {"n":"Peito de frango grelhado, 100 g","d":"Um filé médio grelhado.","t":["almoco","jantar","pos_treino"],"g":["avulso","proteico","fitness"],"p":100,"a":"Frango, peito, sem pele, grelhado"},
    {"n":"Atum em conserva, 1 lata","d":"Uma lata escorrida (120 g).","t":["almoco","jantar","lanche_tarde"],"g":["avulso","proteico"],"p":120,"a":"Atum, conserva em óleo"},
    {"n":"Pão integral, 1 fatia","d":"Uma fatia de pão de forma integral (25 g).","t":["cafe","lanche_tarde"],"g":["avulso"],"p":25,"a":"Pão, trigo, forma, integral"},
    {"n":"Água de coco, 1 copo","d":"Um copo (200 mL).","t":["pre_treino","pos_treino","lanche_tarde"],"g":["avulso"],"p":200,"a":"Coco, água de"},
    {"n":"Café sem açúcar, 1 xícara","d":"Uma xícara pequena (50 mL).","t":["cafe","lanche_manha","lanche_tarde"],"g":["avulso"],"p":50,"a":"Café, infusão 10%"}
  ]$j$;
begin
  for r in select * from jsonb_array_elements(receitas) loop
    insert into public.alimento (familia_id, nome, categoria, fonte) values (null, r ->> 'n', 'Receitas', 'receita') returning id into v_al;
    insert into public.receita (familia_id, alimento_id, nome, descricao, tipos, tags, rendimento_g, porcao_g, modo_preparo)
      values (null, v_al, r ->> 'n', r ->> 'd', array(select jsonb_array_elements_text(r -> 't')), array(select jsonb_array_elements_text(r -> 'g')),
              (r ->> 'r')::numeric, (r ->> 'p')::numeric, r ->> 'm')
      returning id into v_rec;
    for it in select * from jsonb_array_elements(r -> 'i') loop
      select id into v_ing from public.alimento where fonte = 'TACO' and nome = it ->> 0;
      if v_ing is null then raise exception 'ingrediente da TACO não encontrado: %', it ->> 0; end if;
      insert into public.item_receita (receita_id, alimento_id, quantidade_g) values (v_rec, v_ing, (it ->> 1)::numeric);
    end loop;
    perform public._calcular_receita(v_rec);
  end loop;

  for r in select * from jsonb_array_elements(avulsos) loop
    select id into v_al from public.alimento where fonte = 'TACO' and nome = r ->> 'a';
    if v_al is null then raise exception 'alimento da TACO não encontrado: %', r ->> 'a'; end if;
    insert into public.receita (familia_id, alimento_id, nome, descricao, tipos, tags, rendimento_g, porcao_g)
      values (null, v_al, r ->> 'n', r ->> 'd', array(select jsonb_array_elements_text(r -> 't')), array(select jsonb_array_elements_text(r -> 'g')),
              (r ->> 'p')::numeric, (r ->> 'p')::numeric);
  end loop;
end $$;
