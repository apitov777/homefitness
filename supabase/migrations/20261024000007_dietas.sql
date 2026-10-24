-- Dietas: um dia inteiro de refeições para uma pessoa, com opções A/B/C de calorias parecidas em cada
-- refeição, ligado ao gasto do dia. A dieta diz em que dias da semana vale (um dia tem uma dieta só);
-- as refeições dela são plano_refeicao normais (Hoje, avisos e Semana continuam iguais), com a opção A
-- em plano_item e as outras em plano_opcao / plano_opcao_item. Marcar como feita escolhe a opção comida.

create table public.dieta (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references public.pessoa(id) on delete cascade,
  nome text not null,
  kcal_alvo numeric check (kcal_alvo > 0),
  -- 0 = domingo … 6 = sábado; vazio = dieta guardada, sem dia marcado
  dias smallint[] not null default '{}' check (dias <@ '{0,1,2,3,4,5,6}'::smallint[]),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.dieta (pessoa_id);
create trigger dieta_updated_at before update on public.dieta
  for each row execute function public.tocar_updated_at();
alter table public.dieta enable row level security;
create policy "familia gerencia" on public.dieta for all to authenticated
  using (public.pessoa_da_minha_familia(pessoa_id)) with check (public.pessoa_da_minha_familia(pessoa_id));

alter table public.plano_refeicao
  add column dieta_id uuid references public.dieta(id) on delete cascade,
  add column kcal_alvo numeric check (kcal_alvo > 0);
create index on public.plano_refeicao (dieta_id);

-- Opções além da de sempre (plano_item é a opção A): B, C… cada uma com os próprios alimentos.
create table public.plano_opcao (
  id uuid primary key default gen_random_uuid(),
  plano_refeicao_id uuid not null references public.plano_refeicao(id) on delete cascade,
  ordem smallint not null check (ordem >= 1),
  nome text,
  unique (plano_refeicao_id, ordem)
);
create table public.plano_opcao_item (
  id uuid primary key default gen_random_uuid(),
  plano_opcao_id uuid not null references public.plano_opcao(id) on delete cascade,
  alimento_id uuid not null references public.alimento(id),
  quantidade_g numeric not null check (quantidade_g > 0),
  ordem smallint not null default 0
);
create index on public.plano_opcao (plano_refeicao_id);
create index on public.plano_opcao_item (plano_opcao_id);
alter table public.plano_opcao enable row level security;
alter table public.plano_opcao_item enable row level security;
create policy "segue o plano" on public.plano_opcao for all to authenticated
  using (exists (select 1 from public.plano_refeicao pr where pr.id = plano_refeicao_id and public.pessoa_da_minha_familia(pr.pessoa_id)))
  with check (exists (select 1 from public.plano_refeicao pr where pr.id = plano_refeicao_id and public.pessoa_da_minha_familia(pr.pessoa_id)));
create policy "segue a opcao" on public.plano_opcao_item for all to authenticated
  using (exists (select 1 from public.plano_opcao o join public.plano_refeicao pr on pr.id = o.plano_refeicao_id
                 where o.id = plano_opcao_id and public.pessoa_da_minha_familia(pr.pessoa_id)))
  with check (exists (select 1 from public.plano_opcao o join public.plano_refeicao pr on pr.id = o.plano_refeicao_id
                      where o.id = plano_opcao_id and public.pessoa_da_minha_familia(pr.pessoa_id)));

-- Qual opção foi comida (nula = a de sempre ou gramas ajustadas).
alter table public.plano_checagem add column opcao_id uuid references public.plano_opcao(id) on delete set null;

-- As refeições de uma dieta valem nos dias dela; sem dia marcado, ficam inativas (somem de Hoje e dos avisos).
create or replace function public._sincronizar_dieta(p_dieta uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_dias smallint[];
begin
  select dias into v_dias from public.dieta where id = p_dieta;
  if v_dias is null then return; end if;
  update public.plano_refeicao
    set dias = case when cardinality(v_dias) > 0 then v_dias else dias end,
        ativo = cardinality(v_dias) > 0
    where dieta_id = p_dieta;
end $$;
revoke execute on function public._sincronizar_dieta(uuid) from public, anon;
grant execute on function public._sincronizar_dieta(uuid) to authenticated;

-- Cria ou atualiza a dieta. Um dia da semana só pode ter uma dieta por pessoa: os dias escolhidos
-- saem das outras dietas dela.
create or replace function public.salvar_dieta(p_id uuid, p_pessoa uuid, p_nome text, p_kcal_alvo numeric, p_dias smallint[])
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_dias smallint[] := coalesce(p_dias, '{}');
  outra record;
begin
  if nullif(trim(p_nome), '') is null then
    raise exception 'dê um nome à dieta';
  end if;
  if v_id is null then
    insert into public.dieta (pessoa_id, nome, kcal_alvo, dias)
      values (p_pessoa, trim(p_nome), p_kcal_alvo, v_dias)
      returning id into v_id;
  else
    update public.dieta set nome = trim(p_nome), kcal_alvo = p_kcal_alvo, dias = v_dias
      where id = v_id and pessoa_id = p_pessoa;
    if not found then
      raise exception 'dieta não encontrada';
    end if;
  end if;
  if cardinality(v_dias) > 0 then
    for outra in select id from public.dieta where pessoa_id = p_pessoa and id <> v_id and dias && v_dias loop
      update public.dieta
        set dias = coalesce((select array_agg(d order by d) from unnest(dias) d where d <> all (v_dias)), '{}')
        where id = outra.id;
      perform public._sincronizar_dieta(outra.id);
    end loop;
  end if;
  perform public._sincronizar_dieta(v_id);
  return v_id;
end $$;

create or replace function public.apagar_dieta(p_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.dieta where id = p_id;
  if not found then
    raise exception 'dieta não encontrada';
  end if;
end $$;

-- salvar_plano_refeicao ganha a dieta, o alvo de kcal e as opções B, C… (p_opcoes = [{nome, itens: [{alimento_id, quantidade_g}]}]).
-- Com dieta, os dias e o ativo vêm da dieta.
drop function public.salvar_plano_refeicao(uuid, uuid, text, text, time, smallint[], boolean, jsonb);
create or replace function public.salvar_plano_refeicao(
  p_id uuid, p_pessoa uuid, p_tipo text, p_nome text, p_hora time, p_dias smallint[], p_avisar boolean, p_itens jsonb,
  p_dieta uuid default null, p_kcal_alvo numeric default null, p_opcoes jsonb default '[]'::jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_dias smallint[] := p_dias;
  v_ativo boolean := true;
  v_dieta public.dieta;
  it jsonb;
  op jsonb;
  n int := 0;
  v_ordem smallint := 0;
  v_op uuid;
  k int;
begin
  if p_dieta is not null then
    select * into v_dieta from public.dieta where id = p_dieta;
    if not found or v_dieta.pessoa_id <> p_pessoa then
      raise exception 'dieta não encontrada';
    end if;
    if cardinality(v_dieta.dias) > 0 then v_dias := v_dieta.dias; end if;
    v_ativo := cardinality(v_dieta.dias) > 0;
  end if;
  if v_id is null then
    insert into public.plano_refeicao (pessoa_id, tipo, nome, hora, dias, avisar, dieta_id, kcal_alvo, ativo)
      values (p_pessoa, p_tipo, nullif(trim(p_nome), ''), p_hora, v_dias, p_avisar, p_dieta, p_kcal_alvo, v_ativo)
      returning id into v_id;
  else
    update public.plano_refeicao
      set tipo = p_tipo, nome = nullif(trim(p_nome), ''), hora = p_hora, dias = v_dias, avisar = p_avisar,
          dieta_id = p_dieta, kcal_alvo = p_kcal_alvo, ativo = v_ativo
      where id = v_id;
    if not found then
      raise exception 'refeição do plano não encontrada';
    end if;
    delete from public.plano_item where plano_refeicao_id = v_id;
    delete from public.plano_opcao where plano_refeicao_id = v_id;
  end if;
  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    if coalesce((it ->> 'quantidade_g')::numeric, 0) > 0 then
      insert into public.plano_item (plano_refeicao_id, alimento_id, quantidade_g, ordem)
        values (v_id, (it ->> 'alimento_id')::uuid, (it ->> 'quantidade_g')::numeric, n);
      n := n + 1;
    end if;
  end loop;
  if n = 0 then
    raise exception 'coloque pelo menos um alimento com a quantidade em gramas';
  end if;
  for op in select * from jsonb_array_elements(coalesce(p_opcoes, '[]'::jsonb)) loop
    v_ordem := v_ordem + 1;
    insert into public.plano_opcao (plano_refeicao_id, ordem, nome)
      values (v_id, v_ordem, nullif(trim(op ->> 'nome'), ''))
      returning id into v_op;
    k := 0;
    for it in select * from jsonb_array_elements(coalesce(op -> 'itens', '[]'::jsonb)) loop
      if coalesce((it ->> 'quantidade_g')::numeric, 0) > 0 then
        insert into public.plano_opcao_item (plano_opcao_id, alimento_id, quantidade_g, ordem)
          values (v_op, (it ->> 'alimento_id')::uuid, (it ->> 'quantidade_g')::numeric, k);
        k := k + 1;
      end if;
    end loop;
    if k = 0 then
      raise exception 'a opção % ficou sem alimento', chr(64 + v_ordem + 1);
    end if;
  end loop;
  return v_id;
end $$;

-- Marcar como feita: p_opcao escolhe a opção comida (B, C…); sem ela, vale o cardápio do dia ou a opção A.
drop function public.marcar_plano(uuid, date, text, jsonb);
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
  if p_status not in ('feita', 'pulada') then
    raise exception 'status inválido';
  end if;
  if p_opcao is not null and not exists (select 1 from public.plano_opcao where id = p_opcao and plano_refeicao_id = p_plano) then
    raise exception 'opção não é desta refeição';
  end if;
  perform public.desmarcar_plano(p_plano, p_data);

  if p_status = 'feita' then
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

revoke execute on function
  public.salvar_dieta(uuid, uuid, text, numeric, smallint[]), public.apagar_dieta(uuid),
  public.salvar_plano_refeicao(uuid, uuid, text, text, time, smallint[], boolean, jsonb, uuid, numeric, jsonb),
  public.marcar_plano(uuid, date, text, jsonb, uuid)
  from public, anon;
grant execute on function
  public.salvar_dieta(uuid, uuid, text, numeric, smallint[]), public.apagar_dieta(uuid),
  public.salvar_plano_refeicao(uuid, uuid, text, text, time, smallint[], boolean, jsonb, uuid, numeric, jsonb),
  public.marcar_plano(uuid, date, text, jsonb, uuid)
  to authenticated;
