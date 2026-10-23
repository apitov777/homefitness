-- homefitness: esquema base
-- Família (casa) com membros que logam; pessoas da família; alimentos (TACO + próprios);
-- refeições por pessoa, com refeicao_grupo ligando o mesmo prato comido por várias pessoas;
-- metas, medidas, exames. RLS por família; exames só da própria pessoa, salvo se ela compartilhar.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Família e acesso
-- ---------------------------------------------------------------------------

create table public.familia (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.familia_membro (
  familia_id uuid not null references public.familia(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  papel text not null default 'membro' check (papel in ('dono', 'membro')),
  created_at timestamptz not null default now(),
  primary key (familia_id, user_id)
);
create index on public.familia_membro (user_id);

-- Pessoas acompanhadas. user_id é o login da própria pessoa (pode ser nulo, ex.: filho sem login).
create table public.pessoa (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references public.familia(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  nome text not null,
  sexo char(1) check (sexo in ('M', 'F')),
  data_nascimento date,
  altura_cm numeric(5,1),
  nivel_atividade text check (nivel_atividade in ('sedentario', 'leve', 'moderado', 'ativo', 'muito_ativo')),
  objetivo text check (objetivo in ('manter', 'perder', 'perder_lento', 'ganhar', 'saude')),
  restricoes text[],
  preferencias text,
  compartilha_exames boolean not null default false, -- true: a família vê os exames desta pessoa
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (familia_id, user_id)
);
create index on public.pessoa (familia_id);

-- Convite por e-mail: quem logar com esse e-mail entra na família e assume a pessoa indicada.
create table public.familia_convite (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references public.familia(id) on delete cascade,
  email text not null,
  pessoa_id uuid references public.pessoa(id) on delete set null,
  criado_por uuid references auth.users(id) on delete set null,
  aceito_em timestamptz,
  created_at timestamptz not null default now(),
  unique (familia_id, email)
);
create index on public.familia_convite (lower(email));

-- ---------------------------------------------------------------------------
-- Referências (leitura para todos os logados; escrita só service_role)
-- ---------------------------------------------------------------------------

create table public.nutriente (
  id serial primary key,
  codigo text unique not null,
  nome text not null,
  unidade text not null,
  grupo text check (grupo in ('macro', 'vitamina', 'mineral', 'outro')),
  ordem int
);

create table public.nutriente_recomendacao (
  id serial primary key,
  nutriente_id int not null references public.nutriente(id) on delete cascade,
  sexo char(1) check (sexo in ('M', 'F')),
  idade_min int,
  idade_max int,
  rda numeric,
  ai numeric,
  ul numeric,
  fonte text not null default 'DRI/NASEM'
);

create table public.marcador (
  id serial primary key,
  codigo text unique not null,
  nome text not null,
  unidade_padrao text,
  grupo text,
  janela_dias int,
  orientacao_coleta text,
  observacao text
);

create table public.marcador_referencia (
  id serial primary key,
  marcador_id int not null references public.marcador(id) on delete cascade,
  sexo char(1) check (sexo in ('M', 'F')),
  idade_min int,
  idade_max int,
  minimo numeric,
  maximo numeric,
  otimo_min numeric,
  otimo_max numeric,
  fonte text
);

create table public.marcador_nutriente (
  marcador_id int not null references public.marcador(id) on delete cascade,
  nutriente_id int not null references public.nutriente(id) on delete cascade,
  efeito text not null check (efeito in ('aumenta', 'reduz', 'necessario')),
  peso int not null default 1 check (peso between 1 and 3),
  observacao text,
  primary key (marcador_id, nutriente_id)
);

-- ---------------------------------------------------------------------------
-- Alimentos: globais (familia_id nulo, TACO/TBCA) ou da família (rótulo, receita, manual)
-- ---------------------------------------------------------------------------

create table public.alimento (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid references public.familia(id) on delete cascade,
  nome text not null,
  categoria text,
  fonte text not null check (fonte in ('TACO', 'TBCA', 'rotulo', 'receita', 'manual')),
  codigo_fonte text,
  porcao_referencia_g numeric not null default 100,
  medidas_caseiras jsonb not null default '[]'::jsonb, -- [{"nome":"colher de sopa","g":25}]
  marca text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fonte, codigo_fonte)
);
create index on public.alimento (familia_id);
create index alimento_nome_busca on public.alimento using gin (to_tsvector('portuguese', nome));

create table public.alimento_nutriente (
  alimento_id uuid not null references public.alimento(id) on delete cascade,
  nutriente_id int not null references public.nutriente(id) on delete cascade,
  valor_por_100g numeric not null,
  primary key (alimento_id, nutriente_id)
);

create table public.receita (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references public.familia(id) on delete cascade,
  alimento_id uuid unique references public.alimento(id) on delete cascade,
  nome text not null,
  rendimento_g numeric not null check (rendimento_g > 0),
  modo_preparo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.item_receita (
  id uuid primary key default gen_random_uuid(),
  receita_id uuid not null references public.receita(id) on delete cascade,
  alimento_id uuid not null references public.alimento(id),
  quantidade_g numeric not null check (quantidade_g > 0)
);
create index on public.item_receita (receita_id);

-- ---------------------------------------------------------------------------
-- Metas e medidas (uma meta por pessoa e período)
-- ---------------------------------------------------------------------------

create table public.medida_corporal (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references public.pessoa(id) on delete cascade,
  data date not null,
  peso_kg numeric(5,2),
  gordura_pct numeric(4,1),
  cintura_cm numeric(5,1),
  quadril_cm numeric(5,1),
  observacao text,
  created_at timestamptz not null default now(),
  unique (pessoa_id, data)
);

create table public.meta (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references public.pessoa(id) on delete cascade,
  inicio date not null default current_date,
  fim date,
  tmb_kcal numeric,
  tdee_kcal numeric,
  kcal numeric not null check (kcal > 0),
  proteina_g numeric,
  carboidrato_g numeric,
  gordura_g numeric,
  fibra_g numeric,
  agua_ml numeric,
  metodo text,
  observacao text,
  created_at timestamptz not null default now(),
  check (fim is null or fim >= inicio)
);
create index on public.meta (pessoa_id, inicio);
-- No máximo uma meta vigente (sem fim) por pessoa.
create unique index meta_vigente_unica on public.meta (pessoa_id) where fim is null;

create table public.meta_nutriente (
  meta_id uuid not null references public.meta(id) on delete cascade,
  nutriente_id int not null references public.nutriente(id) on delete cascade,
  valor numeric not null,
  primary key (meta_id, nutriente_id)
);

-- ---------------------------------------------------------------------------
-- Refeições
-- ---------------------------------------------------------------------------

-- Um mesmo prato/refeição comido junto: registrado uma vez, gera uma refeicao por pessoa.
create table public.refeicao_grupo (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references public.familia(id) on delete cascade,
  data date not null,
  tipo text not null check (tipo in ('cafe', 'lanche_manha', 'almoco', 'lanche_tarde', 'jantar', 'ceia', 'pre_treino', 'pos_treino', 'outro')),
  hora time,
  receita_id uuid references public.receita(id) on delete set null,
  descricao text,
  criado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.refeicao_grupo (familia_id, data);

create table public.refeicao (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references public.pessoa(id) on delete cascade,
  refeicao_grupo_id uuid references public.refeicao_grupo(id) on delete cascade,
  data date not null,
  tipo text not null check (tipo in ('cafe', 'lanche_manha', 'almoco', 'lanche_tarde', 'jantar', 'ceia', 'pre_treino', 'pos_treino', 'outro')),
  hora time,
  observacao text,
  planejada boolean not null default false,
  criado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (refeicao_grupo_id, pessoa_id)
);
create index on public.refeicao (pessoa_id, data);

create table public.item_refeicao (
  id uuid primary key default gen_random_uuid(),
  refeicao_id uuid not null references public.refeicao(id) on delete cascade,
  alimento_id uuid not null references public.alimento(id),
  quantidade_g numeric not null check (quantidade_g > 0),
  medida_caseira text,
  quantidade_medida numeric
);
create index on public.item_refeicao (refeicao_id);

create table public.suplemento_uso (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references public.pessoa(id) on delete cascade,
  nome text not null,
  nutriente_id int references public.nutriente(id),
  dose numeric,
  unidade text,
  inicio date,
  fim date,
  prescrito_por text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Exames
-- ---------------------------------------------------------------------------

create table public.exame (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references public.pessoa(id) on delete cascade,
  data date not null,
  hora_coleta time,
  laboratorio text,
  jejum_horas numeric,
  treino_48h boolean,
  doente boolean,
  suplementos_em_uso text,
  dia_ciclo int,
  arquivo_url text,
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.exame (pessoa_id, data);

create table public.resultado_exame (
  id uuid primary key default gen_random_uuid(),
  exame_id uuid not null references public.exame(id) on delete cascade,
  marcador_id int not null references public.marcador(id),
  valor numeric not null,
  unidade text,
  ref_min numeric,
  ref_max numeric,
  flag text generated always as (
    case when ref_min is not null and valor < ref_min then 'baixo'
         when ref_max is not null and valor > ref_max then 'alto'
         else 'normal' end) stored
);
create index on public.resultado_exame (exame_id);
create index on public.resultado_exame (marcador_id);

-- ---------------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------------

create or replace function public.tocar_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['familia', 'pessoa', 'alimento', 'receita', 'refeicao', 'exame'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.tocar_updated_at()',
                   t || '_updated_at', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Funções de acesso (security definer para não recursar nas políticas)
-- ---------------------------------------------------------------------------

create or replace function public.eh_membro(p_familia uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.familia_membro
    where familia_id = p_familia and user_id = (select auth.uid()));
$$;

create or replace function public.pessoa_da_minha_familia(p_pessoa uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.pessoa p
    join public.familia_membro m on m.familia_id = p.familia_id
    where p.id = p_pessoa and m.user_id = (select auth.uid()));
$$;

-- Exames: a própria pessoa, ou a família se ela marcou compartilha_exames.
-- Pessoa sem login (user_id nulo) é cuidada pela família.
create or replace function public.pode_ver_exames(p_pessoa uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.pessoa p
    join public.familia_membro m on m.familia_id = p.familia_id
    where p.id = p_pessoa and m.user_id = (select auth.uid())
      and (p.user_id = (select auth.uid()) or p.user_id is null or p.compartilha_exames));
$$;

revoke execute on function public.eh_membro(uuid), public.pessoa_da_minha_familia(uuid), public.pode_ver_exames(uuid) from public, anon;
grant execute on function public.eh_membro(uuid), public.pessoa_da_minha_familia(uuid), public.pode_ver_exames(uuid) to authenticated;

-- Proteção da pessoa: só ela mesma muda o próprio login e a opção de compartilhar exames,
-- e só ela apaga o próprio cadastro. Sem auth.uid() (service_role, SQL editor) passa direto.
create or replace function public.proteger_pessoa()
returns trigger language plpgsql set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    if new.user_id is not null and new.user_id <> v_uid then
      raise exception 'não é possível cadastrar outra pessoa com o login de alguém' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.user_id is not null and old.user_id <> v_uid then
      raise exception 'só a própria pessoa pode apagar o cadastro dela' using errcode = '42501';
    end if;
    return old;
  end if;
  if new.user_id is distinct from old.user_id
     and not (old.user_id is null and new.user_id = v_uid)
     and not (old.user_id = v_uid and new.user_id is null) then
    raise exception 'só a própria pessoa pode mudar o login dela' using errcode = '42501';
  end if;
  if new.compartilha_exames is distinct from old.compartilha_exames
     and old.user_id is not null and old.user_id <> v_uid then
    raise exception 'só a própria pessoa decide se compartilha os exames' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger pessoa_protecao before insert or update or delete on public.pessoa
  for each row execute function public.proteger_pessoa();

-- Cria a família do usuário logado, já como dono, e a pessoa dele.
create or replace function public.criar_familia(p_nome_familia text, p_nome_pessoa text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_familia uuid;
begin
  if (select auth.uid()) is null then raise exception 'precisa estar logado'; end if;
  insert into public.familia (nome) values (p_nome_familia) returning id into v_familia;
  insert into public.familia_membro (familia_id, user_id, papel) values (v_familia, (select auth.uid()), 'dono');
  insert into public.pessoa (familia_id, user_id, nome) values (v_familia, (select auth.uid()), p_nome_pessoa);
  return v_familia;
end $$;

-- Aceita os convites pendentes para o e-mail do usuário logado.
create or replace function public.aceitar_convites()
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower((select auth.jwt() ->> 'email'));
  c record;
  n int := 0;
begin
  if v_uid is null or v_email is null then return 0; end if;
  for c in select * from public.familia_convite where lower(email) = v_email and aceito_em is null loop
    insert into public.familia_membro (familia_id, user_id) values (c.familia_id, v_uid)
      on conflict do nothing;
    if c.pessoa_id is not null then
      update public.pessoa set user_id = v_uid where id = c.pessoa_id and user_id is null;
    end if;
    update public.familia_convite set aceito_em = now() where id = c.id;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.criar_familia(text, text), public.aceitar_convites() from public, anon;
grant execute on function public.criar_familia(text, text), public.aceitar_convites() to authenticated;

-- Registra uma refeição: um grupo e uma refeicao por pessoa, cada uma com suas porções.
-- p_porcoes: [{"pessoa_id": "...", "itens": [{"alimento_id": "...", "quantidade_g": 120, "medida_caseira": "1 concha"}]}]
-- Roda com os direitos de quem chama (security invoker), então a RLS vale.
create or replace function public.registrar_refeicao(
  p_familia uuid, p_data date, p_tipo text, p_hora time, p_descricao text, p_porcoes jsonb,
  p_receita uuid default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_grupo uuid;
  v_ref uuid;
  pp jsonb;
  it jsonb;
begin
  if jsonb_array_length(coalesce(p_porcoes, '[]'::jsonb)) = 0 then
    raise exception 'informe ao menos uma pessoa';
  end if;
  insert into public.refeicao_grupo (familia_id, data, tipo, hora, descricao, receita_id, criado_por)
    values (p_familia, p_data, p_tipo, p_hora, p_descricao, p_receita, (select auth.uid()))
    returning id into v_grupo;
  for pp in select * from jsonb_array_elements(p_porcoes) loop
    if not exists (select 1 from public.pessoa where id = (pp ->> 'pessoa_id')::uuid and familia_id = p_familia) then
      raise exception 'pessoa fora da família';
    end if;
    insert into public.refeicao (pessoa_id, refeicao_grupo_id, data, tipo, hora, criado_por)
      values ((pp ->> 'pessoa_id')::uuid, v_grupo, p_data, p_tipo, p_hora, (select auth.uid()))
      returning id into v_ref;
    for it in select * from jsonb_array_elements(pp -> 'itens') loop
      if coalesce((it ->> 'quantidade_g')::numeric, 0) > 0 then
        insert into public.item_refeicao (refeicao_id, alimento_id, quantidade_g, medida_caseira)
          values (v_ref, (it ->> 'alimento_id')::uuid, (it ->> 'quantidade_g')::numeric, it ->> 'medida_caseira');
      end if;
    end loop;
  end loop;
  return v_grupo;
end $$;

revoke execute on function public.registrar_refeicao(uuid, date, text, time, text, jsonb, uuid) from public, anon;
grant execute on function public.registrar_refeicao(uuid, date, text, time, text, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.familia enable row level security;
alter table public.familia_membro enable row level security;
alter table public.familia_convite enable row level security;
alter table public.pessoa enable row level security;
alter table public.nutriente enable row level security;
alter table public.nutriente_recomendacao enable row level security;
alter table public.marcador enable row level security;
alter table public.marcador_referencia enable row level security;
alter table public.marcador_nutriente enable row level security;
alter table public.alimento enable row level security;
alter table public.alimento_nutriente enable row level security;
alter table public.receita enable row level security;
alter table public.item_receita enable row level security;
alter table public.medida_corporal enable row level security;
alter table public.meta enable row level security;
alter table public.meta_nutriente enable row level security;
alter table public.refeicao_grupo enable row level security;
alter table public.refeicao enable row level security;
alter table public.item_refeicao enable row level security;
alter table public.suplemento_uso enable row level security;
alter table public.exame enable row level security;
alter table public.resultado_exame enable row level security;

-- Família: membros leem e renomeiam; criação só via criar_familia().
create policy "membro le" on public.familia for select to authenticated using (public.eh_membro(id));
create policy "membro edita" on public.familia for update to authenticated using (public.eh_membro(id)) with check (public.eh_membro(id));

create policy "membro le" on public.familia_membro for select to authenticated using (public.eh_membro(familia_id));
create policy "sai da familia" on public.familia_membro for delete to authenticated using (user_id = (select auth.uid()));

create policy "membro gerencia" on public.familia_convite for all to authenticated
  using (public.eh_membro(familia_id)) with check (public.eh_membro(familia_id));

create policy "membro gerencia" on public.pessoa for all to authenticated
  using (public.eh_membro(familia_id)) with check (public.eh_membro(familia_id));

-- Referências: leitura para logados.
create policy "logado le" on public.nutriente for select to authenticated using (true);
create policy "logado le" on public.nutriente_recomendacao for select to authenticated using (true);
create policy "logado le" on public.marcador for select to authenticated using (true);
create policy "logado le" on public.marcador_referencia for select to authenticated using (true);
create policy "logado le" on public.marcador_nutriente for select to authenticated using (true);

-- Alimentos: globais para todos; os da família só para ela.
create policy "le globais e da familia" on public.alimento for select to authenticated
  using (familia_id is null or public.eh_membro(familia_id));
create policy "familia insere" on public.alimento for insert to authenticated
  with check (familia_id is not null and public.eh_membro(familia_id));
create policy "familia edita" on public.alimento for update to authenticated
  using (familia_id is not null and public.eh_membro(familia_id))
  with check (familia_id is not null and public.eh_membro(familia_id));
create policy "familia apaga" on public.alimento for delete to authenticated
  using (familia_id is not null and public.eh_membro(familia_id));

create policy "segue o alimento" on public.alimento_nutriente for select to authenticated
  using (exists (select 1 from public.alimento a where a.id = alimento_id
                 and (a.familia_id is null or public.eh_membro(a.familia_id))));
create policy "familia escreve" on public.alimento_nutriente for all to authenticated
  using (exists (select 1 from public.alimento a where a.id = alimento_id
                 and a.familia_id is not null and public.eh_membro(a.familia_id)))
  with check (exists (select 1 from public.alimento a where a.id = alimento_id
                 and a.familia_id is not null and public.eh_membro(a.familia_id)));

create policy "membro gerencia" on public.receita for all to authenticated
  using (public.eh_membro(familia_id)) with check (public.eh_membro(familia_id));
create policy "segue a receita" on public.item_receita for all to authenticated
  using (exists (select 1 from public.receita r where r.id = receita_id and public.eh_membro(r.familia_id)))
  with check (exists (select 1 from public.receita r where r.id = receita_id and public.eh_membro(r.familia_id)));

-- Dados de alimentação de cada pessoa: a família toda vê e registra (comem juntos).
create policy "familia gerencia" on public.medida_corporal for all to authenticated
  using (public.pessoa_da_minha_familia(pessoa_id)) with check (public.pessoa_da_minha_familia(pessoa_id));
create policy "familia gerencia" on public.meta for all to authenticated
  using (public.pessoa_da_minha_familia(pessoa_id)) with check (public.pessoa_da_minha_familia(pessoa_id));
create policy "segue a meta" on public.meta_nutriente for all to authenticated
  using (exists (select 1 from public.meta m where m.id = meta_id and public.pessoa_da_minha_familia(m.pessoa_id)))
  with check (exists (select 1 from public.meta m where m.id = meta_id and public.pessoa_da_minha_familia(m.pessoa_id)));
create policy "membro gerencia" on public.refeicao_grupo for all to authenticated
  using (public.eh_membro(familia_id)) with check (public.eh_membro(familia_id));
create policy "familia gerencia" on public.refeicao for all to authenticated
  using (public.pessoa_da_minha_familia(pessoa_id)) with check (public.pessoa_da_minha_familia(pessoa_id));
create policy "segue a refeicao" on public.item_refeicao for all to authenticated
  using (exists (select 1 from public.refeicao r where r.id = refeicao_id and public.pessoa_da_minha_familia(r.pessoa_id)))
  with check (exists (select 1 from public.refeicao r where r.id = refeicao_id and public.pessoa_da_minha_familia(r.pessoa_id)));
create policy "familia gerencia" on public.suplemento_uso for all to authenticated
  using (public.pessoa_da_minha_familia(pessoa_id)) with check (public.pessoa_da_minha_familia(pessoa_id));

-- Exames: só a própria pessoa, salvo compartilha_exames.
create policy "dono ou compartilhado" on public.exame for all to authenticated
  using (public.pode_ver_exames(pessoa_id)) with check (public.pode_ver_exames(pessoa_id));
create policy "segue o exame" on public.resultado_exame for all to authenticated
  using (exists (select 1 from public.exame e where e.id = exame_id and public.pode_ver_exames(e.pessoa_id)))
  with check (exists (select 1 from public.exame e where e.id = exame_id and public.pode_ver_exames(e.pessoa_id)));

-- ---------------------------------------------------------------------------
-- Views (security_invoker: respeitam a RLS de quem consulta)
-- ---------------------------------------------------------------------------

create view public.v_item_nutriente with (security_invoker = true) as
select ir.id as item_id, ir.refeicao_id, r.pessoa_id, r.data, r.tipo, r.planejada,
       n.codigo as nutriente, n.unidade,
       an.valor_por_100g * ir.quantidade_g / 100 as valor
from public.item_refeicao ir
join public.refeicao r on r.id = ir.refeicao_id
join public.alimento_nutriente an on an.alimento_id = ir.alimento_id
join public.nutriente n on n.id = an.nutriente_id;

create view public.v_dia_nutriente with (security_invoker = true) as
select pessoa_id, data, nutriente, unidade, sum(valor) as total
from public.v_item_nutriente
where not planejada
group by pessoa_id, data, nutriente, unidade;

create view public.v_dia_vs_meta with (security_invoker = true) as
select d.pessoa_id, d.data,
       round(max(case when d.nutriente = 'energia' then d.total end)) as kcal,
       round(max(case when d.nutriente = 'proteina' then d.total end), 1) as proteina_g,
       round(max(case when d.nutriente = 'carboidrato' then d.total end), 1) as carboidrato_g,
       round(max(case when d.nutriente = 'gordura' then d.total end), 1) as gordura_g,
       round(max(case when d.nutriente = 'fibra' then d.total end), 1) as fibra_g,
       m.kcal as meta_kcal, m.proteina_g as meta_proteina_g, m.carboidrato_g as meta_carboidrato_g,
       m.gordura_g as meta_gordura_g, m.fibra_g as meta_fibra_g
from public.v_dia_nutriente d
left join public.meta m on m.pessoa_id = d.pessoa_id and d.data >= m.inicio and (m.fim is null or d.data <= m.fim)
group by d.pessoa_id, d.data, m.kcal, m.proteina_g, m.carboidrato_g, m.gordura_g, m.fibra_g;

-- Ingestão média dos nutrientes ligados a um marcador, na janela antes da coleta.
create or replace function public.ingestao_antes_exame(p_resultado uuid)
returns table (nutriente text, unidade text, efeito text, media_dia numeric, rda numeric, pct_rda numeric)
language sql stable security invoker set search_path = '' as $$
  with re as (
    select re.marcador_id, e.pessoa_id, e.data, coalesce(m.janela_dias, 30) as janela
    from public.resultado_exame re
    join public.exame e on e.id = re.exame_id
    join public.marcador m on m.id = re.marcador_id
    where re.id = p_resultado),
  p as (
    select p.sexo, extract(year from age(re.data, p.data_nascimento))::int as idade
    from re join public.pessoa p on p.id = re.pessoa_id)
  select n.codigo, n.unidade, mn.efeito,
         round(avg(d.total), 1),
         max(nr.rda),
         round(100 * avg(d.total) / nullif(max(nr.rda), 0), 0)
  from re
  join public.marcador_nutriente mn on mn.marcador_id = re.marcador_id
  join public.nutriente n on n.id = mn.nutriente_id
  left join public.v_dia_nutriente d on d.pessoa_id = re.pessoa_id and d.nutriente = n.codigo
       and d.data between re.data - re.janela and re.data
  left join public.nutriente_recomendacao nr on nr.nutriente_id = n.id
       and nr.sexo = (select sexo from p) and (select idade from p) between nr.idade_min and nr.idade_max
  group by n.codigo, n.unidade, mn.efeito;
$$;
