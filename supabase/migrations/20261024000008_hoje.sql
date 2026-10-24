-- Hoje com registro rápido: a refeição do plano pode ser marcada como "trocada" (comeu outra coisa no lugar:
-- a refeição registrada traz o que comeu, e a checagem guarda que o plano não foi seguido). "Comi algo a mais"
-- é uma refeição comum (registrar_refeicao) com a descrição "A mais".

alter table public.plano_checagem drop constraint plano_checagem_status_check;
alter table public.plano_checagem drop constraint plano_checagem_check;
alter table public.plano_checagem add constraint plano_checagem_status_check check (status in ('feita', 'pulada', 'trocada'));
alter table public.plano_checagem add constraint plano_checagem_check check ((status in ('feita', 'trocada')) = (refeicao_id is not null));

-- Marcar: feita (opção A, a opção p_opcao ou as gramas ajustadas em p_itens), trocada (p_itens com o que comeu
-- no lugar; exige ao menos um alimento) ou pulada.
create or replace function public.marcar_plano(p_plano uuid, p_data date, p_status text, p_itens jsonb default null, p_opcao uuid default null)
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
  if p_status not in ('feita', 'pulada', 'trocada') then
    raise exception 'status inválido';
  end if;
  if p_opcao is not null and not exists (select 1 from public.plano_opcao where id = p_opcao and plano_refeicao_id = p_plano) then
    raise exception 'opção não é desta refeição';
  end if;
  if p_status = 'trocada' and jsonb_array_length(coalesce(p_itens, '[]'::jsonb)) = 0 then
    raise exception 'diga o que comeu no lugar';
  end if;
  perform public.desmarcar_plano(p_plano, p_data);

  if p_status in ('feita', 'trocada') then
    insert into public.refeicao (pessoa_id, data, tipo, hora, observacao, criado_por)
      values (v_plano.pessoa_id, p_data, v_plano.tipo, v_plano.hora, v_plano.nome, (select auth.uid()))
      returning id into v_ref;
    if p_itens is not null then
      for it in select * from jsonb_array_elements(p_itens) loop
        if coalesce((it ->> 'quantidade_g')::numeric, 0) > 0 then
          insert into public.item_refeicao (refeicao_id, alimento_id, quantidade_g)
            values (v_ref, (it ->> 'alimento_id')::uuid, (it ->> 'quantidade_g')::numeric);
        end if;
      end loop;
    elsif p_opcao is not null then
      insert into public.item_refeicao (refeicao_id, alimento_id, quantidade_g)
        select v_ref, alimento_id, quantidade_g from public.plano_opcao_item where plano_opcao_id = p_opcao order by ordem;
    else
      select id into v_dia from public.plano_dia where plano_refeicao_id = p_plano and data = p_data;
      if v_dia is not null then
        insert into public.item_refeicao (refeicao_id, alimento_id, quantidade_g)
          select v_ref, alimento_id, quantidade_g from public.plano_dia_item where plano_dia_id = v_dia order by ordem;
      else
        insert into public.item_refeicao (refeicao_id, alimento_id, quantidade_g)
          select v_ref, alimento_id, quantidade_g from public.plano_item where plano_refeicao_id = p_plano order by ordem;
      end if;
    end if;
    if not exists (select 1 from public.item_refeicao where refeicao_id = v_ref) then
      raise exception 'a refeição ficou sem nenhum alimento';
    end if;
  end if;

  insert into public.plano_checagem (plano_refeicao_id, data, status, refeicao_id, marcado_por, opcao_id)
    values (p_plano, p_data, p_status, v_ref, (select auth.uid()), case when p_status = 'feita' then p_opcao end);
  return v_ref;
end $$;

-- O resumo do dia conta a trocada como refeição feita (comeu, só não foi o que estava no plano).
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
      select count(*) as total, count(*) filter (where c.status in ('feita', 'trocada')) as feitas
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
