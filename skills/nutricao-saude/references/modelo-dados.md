# Modelo de dados — sistema de alimentação e exames (Supabase/Postgres)

Antes de aplicar qualquer coisa no projeto Supabase do usuário, liste as tabelas existentes e siga as convenções que ele já usa (nomes em português e snake_case, `created_at`/`updated_at`, RLS por `auth.uid()`). O que está aqui é a proposta de partida; adapte os nomes se o projeto já tiver padrão diferente.

## Índice
1. Visão geral das entidades
2. DDL completo
3. Tabelas de referência: nutrientes e vínculo marcador ↔ nutriente
4. Importação da TACO
5. Views e consultas úteis
6. Telas sugeridas
7. RLS

---

## 1. Visão geral

```
pessoa ──< meta (vigente por período)
pessoa ──< medida_corporal (peso, % gordura, cintura…)
pessoa ──< refeicao ──< item_refeicao >── alimento ──< alimento_nutriente >── nutriente
pessoa ──< exame (uma coleta) ──< resultado_exame >── marcador ──< marcador_nutriente >── nutriente
pessoa ──< suplemento_uso >── (nutriente ou nome livre)
receita ──< item_receita >── alimento   (receita vira um "alimento composto")
```

Ideia central: **tudo de nutrição é expresso em `nutriente`** (energia, proteína, ferro, vitamina D…). Alimentos têm composição por 100 g; refeições somam; metas e RDAs usam a mesma chave; marcadores de exame apontam para nutrientes. Isso permite a consulta "ingestão média de X nos 90 dias antes da coleta" sem gambiarra.

---

## 2. DDL

```sql
-- Extensões
create extension if not exists "pgcrypto";

-- Pessoas (o usuário e o marido; pode crescer)
create table pessoa (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),      -- dono do registro (quem pode ver/editar)
  nome text not null,
  sexo char(1) check (sexo in ('M','F')),
  data_nascimento date,
  altura_cm numeric(5,1),
  nivel_atividade text check (nivel_atividade in ('sedentario','leve','moderado','ativo','muito_ativo')),
  objetivo text check (objetivo in ('manter','perder','ganhar','saude')),
  restricoes text[],                            -- ex.: {'lactose','gluten'}
  preferencias text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Medidas ao longo do tempo
create table medida_corporal (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references pessoa(id) on delete cascade,
  data date not null,
  peso_kg numeric(5,2),
  gordura_pct numeric(4,1),
  cintura_cm numeric(5,1),
  quadril_cm numeric(5,1),
  observacao text,
  unique (pessoa_id, data)
);

-- Catálogo de nutrientes (chave de tudo)
create table nutriente (
  id serial primary key,
  codigo text unique not null,         -- 'energia','proteina','ferro','vit_d'…
  nome text not null,
  unidade text not null,               -- kcal, g, mg, µg
  grupo text,                          -- macro, vitamina, mineral, outro
  ordem int
);

-- RDA/AI por sexo e faixa etária (DRIs)
create table nutriente_recomendacao (
  id serial primary key,
  nutriente_id int references nutriente(id),
  sexo char(1),
  idade_min int, idade_max int,
  rda numeric, ai numeric, ul numeric,
  fonte text default 'DRI/NASEM'
);

-- Alimentos (TACO, TBCA, rótulo, receita própria)
create table alimento (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  categoria text,
  fonte text not null,                 -- 'TACO','TBCA','rotulo','receita','manual'
  codigo_fonte text,                   -- id na TACO/TBCA
  porcao_referencia_g numeric default 100,
  medidas_caseiras jsonb,              -- [{"nome":"colher de sopa","g":25},{"nome":"concha","g":140}]
  marca text,
  user_id uuid references auth.users(id),   -- null = global (TACO); preenchido = do usuário
  ativo boolean default true,
  created_at timestamptz default now()
);
create index on alimento using gin (to_tsvector('portuguese', nome));

-- Composição por 100 g
create table alimento_nutriente (
  alimento_id uuid references alimento(id) on delete cascade,
  nutriente_id int references nutriente(id),
  valor_por_100g numeric not null,
  primary key (alimento_id, nutriente_id)
);

-- Receitas (alimento composto)
create table receita (
  id uuid primary key default gen_random_uuid(),
  alimento_id uuid unique references alimento(id) on delete cascade, -- a receita aparece como alimento
  rendimento_g numeric not null,
  modo_preparo text,
  user_id uuid references auth.users(id)
);
create table item_receita (
  id uuid primary key default gen_random_uuid(),
  receita_id uuid references receita(id) on delete cascade,
  alimento_id uuid references alimento(id),
  quantidade_g numeric not null
);

-- Metas vigentes por período
create table meta (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references pessoa(id) on delete cascade,
  inicio date not null,
  fim date,                            -- null = vigente
  tmb_kcal numeric, tdee_kcal numeric,
  kcal numeric not null,
  proteina_g numeric, carboidrato_g numeric, gordura_g numeric,
  fibra_g numeric, agua_ml numeric,
  metodo text,                         -- 'mifflin','katch'
  observacao text
);
-- metas de micronutrientes específicas (opcional; senão usa nutriente_recomendacao)
create table meta_nutriente (
  meta_id uuid references meta(id) on delete cascade,
  nutriente_id int references nutriente(id),
  valor numeric not null,
  primary key (meta_id, nutriente_id)
);

-- Refeições registradas
create table refeicao (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references pessoa(id) on delete cascade,
  data date not null,
  tipo text check (tipo in ('cafe','lanche_manha','almoco','lanche_tarde','jantar','ceia','pre_treino','pos_treino','outro')),
  hora time,
  observacao text,
  planejada boolean default false,     -- true = cardápio planejado; false = consumida
  created_at timestamptz default now()
);
create index on refeicao (pessoa_id, data);

create table item_refeicao (
  id uuid primary key default gen_random_uuid(),
  refeicao_id uuid references refeicao(id) on delete cascade,
  alimento_id uuid references alimento(id),
  quantidade_g numeric not null,
  medida_caseira text,                 -- texto original: "2 colheres de sopa"
  quantidade_medida numeric
);

-- Suplementos em uso (importa para exames e para somar nutrientes)
create table suplemento_uso (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid references pessoa(id) on delete cascade,
  nome text not null,                  -- 'Creatina', 'Vitamina D3 2000UI'
  nutriente_id int references nutriente(id),
  dose numeric, unidade text,
  inicio date, fim date,
  prescrito_por text
);

-- Marcadores de exame
create table marcador (
  id serial primary key,
  codigo text unique not null,         -- 'testosterona_total','ferritina','hba1c'
  nome text not null,
  unidade_padrao text,
  grupo text,                          -- hormonal, hematologico, metabolico, lipidico, hepatico, renal, tireoide, vitamina, inflamatorio
  janela_dias int,                     -- quantos dias de ingestão o marcador reflete (90 p/ HbA1c, 21 p/ TG, 120 p/ ferritina…)
  orientacao_coleta text,
  observacao text
);

-- Faixa de referência típica por sexo/idade (só orientação; a do laudo manda)
create table marcador_referencia (
  id serial primary key,
  marcador_id int references marcador(id),
  sexo char(1), idade_min int, idade_max int,
  minimo numeric, maximo numeric, otimo_min numeric, otimo_max numeric,
  fonte text
);

-- O vínculo exame ↔ alimentação
create table marcador_nutriente (
  marcador_id int references marcador(id) on delete cascade,
  nutriente_id int references nutriente(id),
  efeito text check (efeito in ('aumenta','reduz','necessario')),  -- mais ingestão → marcador sobe / desce / é necessário para estar normal
  peso int default 1,                  -- importância relativa 1-3
  observacao text,
  primary key (marcador_id, nutriente_id)
);
-- hábitos não nutricionais (sono, álcool, treino) ficam em texto no marcador.observacao ou numa tabela marcador_habito, se quiser.

-- Uma coleta (um dia no laboratório)
create table exame (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references pessoa(id) on delete cascade,
  data date not null,
  hora_coleta time,
  laboratorio text,
  jejum_horas numeric,
  treino_48h boolean,
  doente boolean,
  suplementos_em_uso text,
  dia_ciclo int,                       -- mulheres
  arquivo_url text,                    -- PDF no Storage
  observacao text,
  created_at timestamptz default now()
);

create table resultado_exame (
  id uuid primary key default gen_random_uuid(),
  exame_id uuid references exame(id) on delete cascade,
  marcador_id int references marcador(id),
  valor numeric not null,
  unidade text,
  ref_min numeric, ref_max numeric,    -- faixa impressa no laudo
  flag text generated always as (
    case when ref_min is not null and valor < ref_min then 'baixo'
         when ref_max is not null and valor > ref_max then 'alto'
         else 'normal' end) stored
);
create index on resultado_exame (marcador_id);
```

---

## 3. Dados de referência

### Nutrientes mínimos (insira primeiro)
`energia (kcal), proteina (g), carboidrato (g), gordura (g), gordura_saturada (g), fibra (g), acucar (g), sodio (mg), potassio (mg), calcio (mg), magnesio (mg), ferro (mg), zinco (mg), selenio (µg), iodo (µg), fosforo (mg), cobre (mg), vit_a (µg), vit_c (mg), vit_d (µg), vit_e (mg), vit_k (µg), b1 (mg), b2 (mg), b3 (mg), b6 (mg), b9 (µg), b12 (µg), colina (mg), omega3 (g), agua (ml), alcool (g), cafeina (mg)`

Os valores de RDA/AI/UL estão em `nutrientes.md` desta skill; carregue em `nutriente_recomendacao` por sexo e faixa (19–30, 31–50, 51–70, >70).

### Vínculos marcador ↔ nutriente (semente)

| marcador | nutriente | efeito |
|---|---|---|
| testosterona_total | zinco, magnesio, vit_d, gordura, energia | necessario |
| testosterona_total | alcool | reduz |
| ferritina | ferro, vit_c, cobre | necessario |
| ferritina | cafeina, calcio (na mesma refeição) | reduz |
| hemoglobina | ferro, b12, b9, vit_c | necessario |
| homocisteina | b12, b9, b6 | reduz |
| vit_d_25oh | vit_d, gordura | necessario |
| tsh / t3 | selenio, iodo, zinco, ferro, energia | necessario |
| triglicerideos | acucar, alcool, carboidrato | aumenta |
| triglicerideos | omega3, fibra | reduz |
| ldl | gordura_saturada | aumenta |
| ldl | fibra, gordura (insaturada) | reduz |
| hdl | gordura (mono), omega3 | aumenta |
| hba1c / glicemia / insulina | acucar, carboidrato | aumenta |
| hba1c / glicemia / insulina | fibra, proteina, magnesio | reduz |
| tgp / ggt | alcool, acucar, energia | aumenta |
| creatinina | proteina, creatina (suplemento) | aumenta |
| ureia | proteina | aumenta |
| acido_urico | alcool, proteina (purinas), acucar (frutose) | aumenta |
| acido_urico | calcio (laticínios), vit_c, cafeina, agua | reduz |
| pcr_us | omega3, fibra | reduz |
| pcr_us | gordura_saturada, acucar | aumenta |

`janela_dias` sugeridos: hba1c 90, triglicerideos 21, ldl 42, ferritina 120, hemoglobina 90, vit_d_25oh 90, testosterona_total 60, tsh 60, glicemia 7, insulina 30, creatinina 7, tgp 30, pcr_us 30, acido_urico 14.

---

## 4. Importação da TACO

A TACO (4ª edição, UNICAMP/NEPA) é distribuída em PDF e planilha; existem CSVs convertidos no GitHub (procure "TACO csv" — confira a licença e a edição). Passos:

1. Baixe a planilha/CSV para uma pasta isolada; leia com `python -I`.
2. Mapeie as colunas para os `codigo` de `nutriente` (energia_kcal → energia, proteina_g → proteina, etc.). Valores "NA" e "Tr" (traço) → null e 0.
3. Insira em `alimento` com `fonte='TACO'`, `codigo_fonte` = número da TACO, `user_id` null, `categoria` = grupo da TACO.
4. Insira em `alimento_nutriente` um registro por nutriente disponível.
5. Medidas caseiras: a TACO não traz; use a tabela de medidas caseiras do "Guia Alimentar" / IBGE-POF ou cadastre manualmente as mais usadas (colher de sopa de arroz ≈ 25 g, concha de feijão ≈ 140 g, filé de frango médio ≈ 100 g, ovo ≈ 50 g, pão francês ≈ 50 g, banana prata ≈ 70 g).

A TBCA (USP) tem API e dados mais completos de micronutrientes; pode complementar a TACO usando `fonte='TBCA'`.

---

## 5. Views e consultas úteis

```sql
-- Nutrição de cada item de refeição
create view v_item_nutriente as
select ir.id as item_id, r.pessoa_id, r.data, r.tipo, r.planejada,
       n.codigo as nutriente, an.valor_por_100g * ir.quantidade_g / 100 as valor
from item_refeicao ir
join refeicao r on r.id = ir.refeicao_id
join alimento_nutriente an on an.alimento_id = ir.alimento_id
join nutriente n on n.id = an.nutriente_id;

-- Totais por dia e pessoa (só consumido)
create view v_dia_nutriente as
select pessoa_id, data, nutriente, sum(valor) as total
from v_item_nutriente where not planejada
group by pessoa_id, data, nutriente;

-- Dia vs meta (macros)
create view v_dia_vs_meta as
select d.pessoa_id, d.data,
       max(case when nutriente='energia' then total end) as kcal,
       max(case when nutriente='proteina' then total end) as proteina_g,
       max(case when nutriente='carboidrato' then total end) as carboidrato_g,
       max(case when nutriente='gordura' then total end) as gordura_g,
       m.kcal as meta_kcal, m.proteina_g as meta_proteina, m.carboidrato_g as meta_carbo, m.gordura_g as meta_gordura
from v_dia_nutriente d
join meta m on m.pessoa_id = d.pessoa_id and d.data >= m.inicio and (m.fim is null or d.data <= m.fim)
group by d.pessoa_id, d.data, m.kcal, m.proteina_g, m.carboidrato_g, m.gordura_g;

-- Ingestão média dos nutrientes ligados a um marcador, na janela antes da coleta
create or replace function ingestao_antes_exame(p_resultado uuid)
returns table (nutriente text, efeito text, media_dia numeric, rda numeric, pct_rda numeric) language sql as $$
  with re as (
    select re.*, e.pessoa_id, e.data, m.janela_dias, m.id as marcador_id
    from resultado_exame re join exame e on e.id = re.exame_id join marcador m on m.id = re.marcador_id
    where re.id = p_resultado),
  p as (select p.sexo, extract(year from age(re.data, p.data_nascimento))::int as idade from re join pessoa p on p.id = re.pessoa_id)
  select n.codigo, mn.efeito,
         round(avg(d.total),1),
         nr.rda,
         round(100*avg(d.total)/nullif(nr.rda,0),0)
  from re
  join marcador_nutriente mn on mn.marcador_id = re.marcador_id
  join nutriente n on n.id = mn.nutriente_id
  left join v_dia_nutriente d on d.pessoa_id = re.pessoa_id and d.nutriente = n.codigo
       and d.data between re.data - coalesce(re.janela_dias,30) and re.data
  left join nutriente_recomendacao nr on nr.nutriente_id = n.id
       and nr.sexo = (select sexo from p) and (select idade from p) between nr.idade_min and nr.idade_max
  group by n.codigo, mn.efeito, nr.rda;
$$;

-- Evolução de um marcador
select e.data, re.valor, re.unidade, re.flag
from resultado_exame re join exame e on e.id = re.exame_id
where e.pessoa_id = :pessoa and re.marcador_id = (select id from marcador where codigo = :marcador)
order by e.data;

-- Lista de compras de um período planejado
select a.nome, sum(ir.quantidade_g) as total_g, a.categoria
from item_refeicao ir join refeicao r on r.id = ir.refeicao_id join alimento a on a.id = ir.alimento_id
where r.planejada and r.pessoa_id in (:pessoas) and r.data between :ini and :fim
group by a.nome, a.categoria order by a.categoria, a.nome;
```

---

## 6. Telas sugeridas

1. **Hoje** — por pessoa: anel de calorias, barras de macros, lista de refeições do dia, botão "registrar" com busca de alimento + medida caseira.
2. **Cardápio da semana** — grade dias × refeições, com toggle de pessoa, base comum + ajustes, gera lista de compras.
3. **Nutrientes** — radar/barras de micronutrientes vs RDA nos últimos 7 e 30 dias; destaque dos que estão < 70%.
4. **Exames** — timeline por marcador com faixa sombreada; ao clicar num resultado, painel "o que influencia" trazendo `ingestao_antes_exame` e os alimentos do banco que são fonte.
5. **Perfil e metas** — dados da pessoa, histórico de peso, meta vigente com o cálculo exposto.
6. **Alimentos** — catálogo TACO + próprios + receitas.

---

## 7. RLS

```sql
alter table pessoa enable row level security;
create policy "dono" on pessoa for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Nas tabelas filhas, checar via pessoa:
alter table refeicao enable row level security;
create policy "dono" on refeicao for all
  using (exists (select 1 from pessoa p where p.id = refeicao.pessoa_id and p.user_id = auth.uid()));
-- Repetir o padrão para medida_corporal, meta, exame, suplemento_uso; item_refeicao e resultado_exame checam pela tabela pai.
-- alimento: leitura pública dos globais (user_id is null) + os do próprio usuário; escrita só nos próprios.
-- nutriente, marcador, *_recomendacao, *_referencia, marcador_nutriente: leitura para authenticated, escrita só service_role.
```

Como as duas pessoas (usuário e marido) vão usar o mesmo sistema, defina se cada um tem seu login (então `pessoa.user_id` aponta para cada um e precisa de uma tabela `pessoa_acesso` para o outro ver) ou se é um login compartilhado da casa (mais simples: as duas pessoas têm o mesmo `user_id`). Pergunte antes de implementar.
