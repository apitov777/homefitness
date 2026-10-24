-- Semana e mês: receitas pesadas, cardápio por dia, treinos e a meta do dia acompanhando o gasto.
-- Receita: ingredientes em gramas + peso da panela pronta; vira um alimento com o valor por 100 g calculado.
-- Cardápio: para um dia, uma refeição do plano pode trocar os itens de sempre por uma receita (ou outros itens).
-- Treino: atividade, minutos e dias da semana; gasto pelo MET líquido ou pelas calorias do relógio.
-- Meta do dia: fixa (como antes) ou acompanhando o treino: (TMB × fator da rotina + treino) × (meta / gasto total).

-- ---------------------------------------------------------------------------
-- Receitas
-- ---------------------------------------------------------------------------

alter table public.receita
  add column tipos text[] not null default '{almoco}'
    check (cardinality(tipos) > 0 and tipos <@ array['cafe', 'lanche_manha', 'almoco', 'lanche_tarde', 'jantar', 'ceia', 'pre_treino', 'pos_treino', 'outro']),
  add column ativa boolean not null default true;

-- Cria ou edita a receita e recalcula o valor por 100 g a partir dos ingredientes e do peso pronto.
-- Se a receita já foi comida, a versão antiga fica guardada para o histórico e o plano passa a usar a nova.
-- p_itens: [{"alimento_id": "...", "quantidade_g": 300}]
create or replace function public.salvar_receita(
  p_id uuid, p_nome text, p_tipos text[], p_rendimento_g numeric, p_modo_preparo text, p_itens jsonb)
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
    insert into public.receita (familia_id, alimento_id, nome, rendimento_g, modo_preparo, tipos)
      values (v_familia, v_alimento, trim(p_nome), p_rendimento_g, nullif(trim(p_modo_preparo), ''), p_tipos)
      returning id into v_receita;
  else
    select alimento_id into v_antigo from public.receita where id = v_receita;
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
          modo_preparo = nullif(trim(p_modo_preparo), ''), tipos = p_tipos, ativa = true
      where id = v_receita;
  end if;

  delete from public.item_receita where receita_id = v_receita;
  for it in select * from jsonb_array_elements(p_itens) loop
    if coalesce((it ->> 'quantidade_g')::numeric, 0) > 0 then
      insert into public.item_receita (receita_id, alimento_id, quantidade_g)
        values (v_receita, (it ->> 'alimento_id')::uuid, (it ->> 'quantidade_g')::numeric);
    end if;
  end loop;

  delete from public.alimento_nutriente where alimento_id = v_alimento;
  insert into public.alimento_nutriente (alimento_id, nutriente_id, valor_por_100g)
    select v_alimento, an.nutriente_id, round(sum(an.valor_por_100g * ir.quantidade_g / 100) / p_rendimento_g * 100, 4)
    from public.item_receita ir
    join public.alimento_nutriente an on an.alimento_id = ir.alimento_id
    where ir.receita_id = v_receita
    group by an.nutriente_id;
  return v_receita;
end $$;

-- Arquivar tira a receita das listas sem mexer no que já foi comido.
create or replace function public.arquivar_receita(p_id uuid)
returns void language sql security invoker set search_path = '' as $$
  update public.alimento set ativo = false where id = (select alimento_id from public.receita where id = p_id);
  update public.receita set ativa = false where id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- Cardápio do dia
-- ---------------------------------------------------------------------------

create table public.plano_dia (
  id uuid primary key default gen_random_uuid(),
  plano_refeicao_id uuid not null references public.plano_refeicao(id) on delete cascade,
  data date not null,
  receita_id uuid references public.receita(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plano_refeicao_id, data)
);
create index on public.plano_dia (data);
create trigger plano_dia_updated_at before update on public.plano_dia
  for each row execute function public.tocar_updated_at();

create table public.plano_dia_item (
  id uuid primary key default gen_random_uuid(),
  plano_dia_id uuid not null references public.plano_dia(id) on delete cascade,
  alimento_id uuid not null references public.alimento(id),
  quantidade_g numeric not null check (quantidade_g > 0),
  ordem smallint not null default 0
);
create index on public.plano_dia_item (plano_dia_id);

alter table public.plano_dia enable row level security;
alter table public.plano_dia_item enable row level security;
create policy "segue o plano" on public.plano_dia for all to authenticated
  using (exists (select 1 from public.plano_refeicao pr where pr.id = plano_refeicao_id and public.pessoa_da_minha_familia(pr.pessoa_id)))
  with check (exists (select 1 from public.plano_refeicao pr where pr.id = plano_refeicao_id and public.pessoa_da_minha_familia(pr.pessoa_id)));
create policy "segue o dia" on public.plano_dia_item for all to authenticated
  using (exists (select 1 from public.plano_dia d join public.plano_refeicao pr on pr.id = d.plano_refeicao_id
                 where d.id = plano_dia_id and public.pessoa_da_minha_familia(pr.pessoa_id)))
  with check (exists (select 1 from public.plano_dia d join public.plano_refeicao pr on pr.id = d.plano_refeicao_id
                      where d.id = plano_dia_id and public.pessoa_da_minha_familia(pr.pessoa_id)));

-- Define o cardápio de vários dias de uma vez. Itens vazios voltam a refeição ao plano de sempre.
-- p_dias: [{"plano": "...", "data": "2026-10-26", "receita": "..." | null, "itens": [{"alimento_id", "quantidade_g"}]}]
create or replace function public.definir_dias(p_dias jsonb)
returns int language plpgsql security invoker set search_path = '' as $$
declare
  d jsonb;
  it jsonb;
  v_id uuid;
  v_ordem smallint;
  n int := 0;
begin
  for d in select * from jsonb_array_elements(coalesce(p_dias, '[]'::jsonb)) loop
    if not exists (select 1 from public.plano_refeicao where id = (d ->> 'plano')::uuid) then
      raise exception 'refeição do plano não encontrada';
    end if;
    delete from public.plano_dia where plano_refeicao_id = (d ->> 'plano')::uuid and data = (d ->> 'data')::date;
    if jsonb_array_length(coalesce(d -> 'itens', '[]'::jsonb)) > 0 then
      insert into public.plano_dia (plano_refeicao_id, data, receita_id)
        values ((d ->> 'plano')::uuid, (d ->> 'data')::date, nullif(d ->> 'receita', '')::uuid)
        returning id into v_id;
      v_ordem := 0;
      for it in select * from jsonb_array_elements(d -> 'itens') loop
        if coalesce((it ->> 'quantidade_g')::numeric, 0) > 0 then
          insert into public.plano_dia_item (plano_dia_id, alimento_id, quantidade_g, ordem)
            values (v_id, (it ->> 'alimento_id')::uuid, (it ->> 'quantidade_g')::numeric, v_ordem);
          v_ordem := v_ordem + 1;
        end if;
      end loop;
      if v_ordem = 0 then raise exception 'o dia ficou sem nenhum alimento'; end if;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Marcar como feita usa o cardápio do dia quando houver; senão, os itens de sempre.
create or replace function public.marcar_plano(p_plano uuid, p_data date, p_status text, p_itens jsonb default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_plano public.plano_refeicao;
  v_dia uuid;
  v_ref uuid;
  it jsonb;
begin
  select * into v_plano from public.plano_refeicao where id = p_plano;
  if not found then
    raise exception 'refeição do plano não encontrada';
  end if;
  if p_status not in ('feita', 'pulada') then
    raise exception 'status inválido';
  end if;
  perform public.desmarcar_plano(p_plano, p_data);

  if p_status = 'feita' then
    insert into public.refeicao (pessoa_id, data, tipo, hora, observacao, criado_por)
      values (v_plano.pessoa_id, p_data, v_plano.tipo, v_plano.hora, v_plano.nome, (select auth.uid()))
      returning id into v_ref;
    if p_itens is null then
      select id into v_dia from public.plano_dia where plano_refeicao_id = p_plano and data = p_data;
      if v_dia is not null then
        insert into public.item_refeicao (refeicao_id, alimento_id, quantidade_g)
          select v_ref, alimento_id, quantidade_g from public.plano_dia_item where plano_dia_id = v_dia order by ordem;
      else
        insert into public.item_refeicao (refeicao_id, alimento_id, quantidade_g)
          select v_ref, alimento_id, quantidade_g from public.plano_item where plano_refeicao_id = p_plano order by ordem;
      end if;
    else
      for it in select * from jsonb_array_elements(p_itens) loop
        if coalesce((it ->> 'quantidade_g')::numeric, 0) > 0 then
          insert into public.item_refeicao (refeicao_id, alimento_id, quantidade_g)
            values (v_ref, (it ->> 'alimento_id')::uuid, (it ->> 'quantidade_g')::numeric);
        end if;
      end loop;
    end if;
    if not exists (select 1 from public.item_refeicao where refeicao_id = v_ref) then
      raise exception 'a refeição ficou sem nenhum alimento';
    end if;
  end if;

  insert into public.plano_checagem (plano_refeicao_id, data, status, refeicao_id, marcado_por)
    values (p_plano, p_data, p_status, v_ref, (select auth.uid()));
  return v_ref;
end $$;

-- ---------------------------------------------------------------------------
-- Treinos e meta do dia
-- ---------------------------------------------------------------------------

create table public.treino_plano (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references public.pessoa(id) on delete cascade,
  atividade text not null,
  met numeric check (met > 1 and met < 25),            -- Compendium of Physical Activities
  minutos int not null check (minutos between 5 and 600),
  kcal_informada numeric check (kcal_informada > 0),   -- calorias ativas do relógio, por sessão
  dias smallint[] not null check (cardinality(dias) > 0 and dias <@ '{0,1,2,3,4,5,6}'::smallint[]),
  hora time,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (met is not null or kcal_informada is not null)
);
create index on public.treino_plano (pessoa_id);
create trigger treino_plano_updated_at before update on public.treino_plano
  for each row execute function public.tocar_updated_at();
alter table public.treino_plano enable row level security;
create policy "familia gerencia" on public.treino_plano for all to authenticated
  using (public.pessoa_da_minha_familia(pessoa_id)) with check (public.pessoa_da_minha_familia(pessoa_id));

alter table public.pessoa
  add column fator_rotina numeric not null default 1.2 check (fator_rotina between 1.1 and 1.6),
  add column meta_pelo_treino boolean not null default false;

-- Meta e gasto de cada pessoa em cada dia do período.
-- Treino: kcal do relógio, ou (MET − 1) × peso × horas (o 1 MET de repouso já está na TMB).
-- Fixa: a meta vigente. Pelo treino: max(TMB, (TMB × fator da rotina + treino) × meta/gasto total da meta),
-- com a diferença indo para o carboidrato (proteína e gordura ficam).
create or replace function public.metas_do_periodo(p_pessoas uuid[], p_de date, p_ate date)
returns table (pessoa_id uuid, data date, kcal numeric, proteina_g numeric, carboidrato_g numeric, gordura_g numeric,
               tmb_kcal numeric, gasto_kcal numeric, treino_kcal numeric, pelo_treino boolean)
language sql stable security invoker set search_path = '' as $$
  with base as (
    select p.id as pessoa_id, d::date as data, p.fator_rotina, p.meta_pelo_treino,
           m.kcal, m.tmb_kcal, m.tdee_kcal, m.proteina_g, m.carboidrato_g, m.gordura_g,
           (select mc.peso_kg from public.medida_corporal mc
             where mc.pessoa_id = p.id and mc.data <= d::date and mc.peso_kg is not null
             order by mc.data desc limit 1) as peso
    from public.pessoa p
    cross join generate_series(p_de, p_ate, interval '1 day') d
    left join public.meta m on m.pessoa_id = p.id and d::date >= m.inicio and (m.fim is null or d::date <= m.fim)
    where p.id = any (p_pessoas) and p_ate - p_de <= 62
  ),
  com_treino as (
    select b.*,
           coalesce((select sum(coalesce(t.kcal_informada, (t.met - 1) * b.peso * t.minutos / 60.0))
                     from public.treino_plano t
                     where t.pessoa_id = b.pessoa_id and t.ativo
                       and extract(dow from b.data)::smallint = any (t.dias)), 0) as treino,
           b.meta_pelo_treino and b.tmb_kcal is not null and b.tdee_kcal > 0 and b.kcal is not null as pelo
    from base b
  ),
  dia as (
    select c.*,
           case when c.pelo then c.tmb_kcal * c.fator_rotina + c.treino else c.tdee_kcal end as gasto,
           case when c.pelo then greatest(c.tmb_kcal, (c.tmb_kcal * c.fator_rotina + c.treino) * c.kcal / c.tdee_kcal)
                else c.kcal end as kcal_dia
    from com_treino c
  )
  select pessoa_id, data, round(kcal_dia), proteina_g,
         case when pelo then greatest(0, round(carboidrato_g + (kcal_dia - kcal) / 4)) else carboidrato_g end,
         gordura_g, round(tmb_kcal), round(gasto), round(treino), pelo
  from dia
  order by pessoa_id, data;
$$;

revoke execute on function
  public.salvar_receita(uuid, text, text[], numeric, text, jsonb), public.arquivar_receita(uuid),
  public.definir_dias(jsonb), public.metas_do_periodo(uuid[], date, date)
  from public, anon;
grant execute on function
  public.salvar_receita(uuid, text, text[], numeric, text, jsonb), public.arquivar_receita(uuid),
  public.definir_dias(jsonb), public.metas_do_periodo(uuid[], date, date)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Avisos: a refeição avisa com o cardápio do dia; o resumo usa a meta do dia.
-- ---------------------------------------------------------------------------

create or replace function public.avisos_devidos(p_agora timestamptz default now())
returns table (chave text, user_id uuid, titulo text, corpo text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  return query
  with local as (
    select p.id as pessoa_id, p.user_id, p.nome, p.aviso_resumo,
           (p_agora at time zone p.fuso)::date as dia,
           (p_agora at time zone p.fuso)::time as agora
    from public.pessoa p
    where p.user_id is not null
  ),
  refeicoes as (
    select 'refeicao:' || pr.id || ':' || l.dia as chave, l.user_id,
           coalesce(pr.nome, case pr.tipo
             when 'cafe' then 'Café da manhã' when 'lanche_manha' then 'Lanche da manhã'
             when 'almoco' then 'Almoço' when 'lanche_tarde' then 'Lanche da tarde'
             when 'jantar' then 'Jantar' when 'ceia' then 'Ceia' when 'pre_treino' then 'Pré-treino'
             when 'pos_treino' then 'Pós-treino' else 'Refeição' end) || ' · ' || to_char(pr.hora, 'HH24:MI') as titulo,
           coalesce((
             select string_agg(split_part(al.nome, ',', 1) || ' ' || trim(to_char(i.quantidade_g, 'FM999990')) || ' g', ', ' order by i.ordem)
             from (
               select di.alimento_id, di.quantidade_g, di.ordem from public.plano_dia_item di
               join public.plano_dia pd on pd.id = di.plano_dia_id
               where pd.plano_refeicao_id = pr.id and pd.data = l.dia
               union all
               select pi.alimento_id, pi.quantidade_g, pi.ordem from public.plano_item pi
               where pi.plano_refeicao_id = pr.id
                 and not exists (select 1 from public.plano_dia pd where pd.plano_refeicao_id = pr.id and pd.data = l.dia)
             ) i
             join public.alimento al on al.id = i.alimento_id), 'Hora de comer') ||
           '. Abra o app e marque se fez.' as corpo
    from public.plano_refeicao pr
    join local l on l.pessoa_id = pr.pessoa_id
    where pr.ativo and pr.avisar
      and extract(dow from l.dia)::smallint = any (pr.dias)
      and l.agora - pr.hora >= interval '0' and l.agora - pr.hora < interval '15 minutes'
      and not exists (select 1 from public.plano_checagem c where c.plano_refeicao_id = pr.id and c.data = l.dia)
  ),
  resumos as (
    select 'resumo:' || l.pessoa_id || ':' || l.dia as chave, l.user_id,
           case
             when m.kcal is null then 'Resumo do dia'
             when coalesce(v.kcal, 0) between m.kcal * 0.9 and m.kcal * 1.1 then 'Meta do dia batida ✅'
             else 'Meta do dia não batida'
           end as titulo,
           replace(to_char(coalesce(v.kcal, 0), 'FM999,990'), ',', '.') ||
             coalesce(' de ' || replace(to_char(m.kcal, 'FM999,990'), ',', '.') || ' kcal (' || round(100 * coalesce(v.kcal, 0) / m.kcal) || '%)', ' kcal') ||
             coalesce(', proteína ' || round(coalesce(v.proteina_g, 0)) || ' de ' || round(m.proteina_g) || ' g', '') ||
             case when pl.total > 0 then '. ' || pl.feitas || ' de ' || pl.total || ' refeições do plano feitas.' else '.' end as corpo
    from local l
    left join lateral public.metas_do_periodo(array[l.pessoa_id], l.dia, l.dia) m on true
    left join public.v_dia_vs_meta v on v.pessoa_id = l.pessoa_id and v.data = l.dia
    cross join lateral (
      select count(*) as total, count(*) filter (where c.status = 'feita') as feitas
      from public.plano_refeicao pr
      left join public.plano_checagem c on c.plano_refeicao_id = pr.id and c.data = l.dia
      where pr.pessoa_id = l.pessoa_id and pr.ativo and extract(dow from l.dia)::smallint = any (pr.dias)
    ) pl
    where l.aviso_resumo is not null
      and (m.kcal is not null or pl.total > 0)
      and l.agora - l.aviso_resumo >= interval '0' and l.agora - l.aviso_resumo < interval '15 minutes'
  ),
  devidos as (select * from refeicoes union all select * from resumos),
  reservados as (
    insert into public.aviso_enviado (chave) select d.chave from devidos d
    on conflict do nothing
    returning aviso_enviado.chave
  )
  select d.chave, d.user_id, d.titulo, d.corpo from devidos d join reservados r on r.chave = d.chave;

  delete from public.aviso_enviado where enviado_em < p_agora - interval '3 days';
end $$;

-- ---------------------------------------------------------------------------
-- Mudança de família: o cardápio do dia vai junto, com cópia dos alimentos próprios.
-- ---------------------------------------------------------------------------

create or replace function public._mover_pessoa(p_pessoa uuid, p_destino uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_origem uuid;
  a record;
  g record;
  v_novo uuid;
begin
  select familia_id into v_origem from public.pessoa where id = p_pessoa;
  if v_origem is null or v_origem = p_destino then return; end if;

  for a in
    select al.* from public.alimento al
    where al.familia_id = v_origem and al.id in (
      select ir.alimento_id from public.item_refeicao ir
      join public.refeicao r on r.id = ir.refeicao_id where r.pessoa_id = p_pessoa
      union
      select pi.alimento_id from public.plano_item pi
      join public.plano_refeicao pr on pr.id = pi.plano_refeicao_id where pr.pessoa_id = p_pessoa
      union
      select di.alimento_id from public.plano_dia_item di
      join public.plano_dia pd on pd.id = di.plano_dia_id
      join public.plano_refeicao pr on pr.id = pd.plano_refeicao_id where pr.pessoa_id = p_pessoa)
  loop
    insert into public.alimento (familia_id, nome, categoria, fonte, porcao_referencia_g, medidas_caseiras, marca, ativo)
      values (p_destino, a.nome, a.categoria, a.fonte, a.porcao_referencia_g, a.medidas_caseiras, a.marca, a.ativo)
      returning id into v_novo;
    insert into public.alimento_nutriente (alimento_id, nutriente_id, valor_por_100g)
      select v_novo, nutriente_id, valor_por_100g from public.alimento_nutriente where alimento_id = a.id;
    update public.item_refeicao ir set alimento_id = v_novo
      from public.refeicao r
      where r.id = ir.refeicao_id and r.pessoa_id = p_pessoa and ir.alimento_id = a.id;
    update public.plano_item pi set alimento_id = v_novo
      from public.plano_refeicao pr
      where pr.id = pi.plano_refeicao_id and pr.pessoa_id = p_pessoa and pi.alimento_id = a.id;
    update public.plano_dia_item di set alimento_id = v_novo
      from public.plano_dia pd join public.plano_refeicao pr on pr.id = pd.plano_refeicao_id
      where pd.id = di.plano_dia_id and pr.pessoa_id = p_pessoa and di.alimento_id = a.id;
  end loop;
  -- A receita fica com a família; o dia guarda os itens, só perde o vínculo.
  update public.plano_dia pd set receita_id = null
    from public.plano_refeicao pr
    where pr.id = pd.plano_refeicao_id and pr.pessoa_id = p_pessoa and pd.receita_id is not null;

  for g in
    select rg.* from public.refeicao_grupo rg
    where rg.id in (select refeicao_grupo_id from public.refeicao where pessoa_id = p_pessoa)
  loop
    insert into public.refeicao_grupo (familia_id, data, tipo, hora, descricao, criado_por)
      values (p_destino, g.data, g.tipo, g.hora, g.descricao, g.criado_por)
      returning id into v_novo;
    update public.refeicao set refeicao_grupo_id = v_novo where refeicao_grupo_id = g.id and pessoa_id = p_pessoa;
    delete from public.refeicao_grupo rg
      where rg.id = g.id and not exists (select 1 from public.refeicao r where r.refeicao_grupo_id = g.id);
  end loop;

  delete from public.familia_convite where pessoa_id = p_pessoa;
  update public.pessoa set familia_id = p_destino where id = p_pessoa;
end $$;

revoke execute on function public._mover_pessoa(uuid, uuid) from public, anon, authenticated;
