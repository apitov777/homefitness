-- Plano de refeições: o que cada pessoa pretende comer, em que horário e com quantos gramas.
-- No dia, cada refeição do plano é marcada como feita (vira uma refeição registrada) ou pulada.
-- Os avisos no celular saem por Web Push (função avisos, chamada pelo pg_cron a cada minuto).

alter table public.pessoa
  add column fuso text not null default 'America/Sao_Paulo',
  add column aviso_resumo time default '21:30'; -- hora do resumo do dia; null = sem resumo

create table public.plano_refeicao (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references public.pessoa(id) on delete cascade,
  tipo text not null check (tipo in ('cafe', 'lanche_manha', 'almoco', 'lanche_tarde', 'jantar', 'ceia', 'pre_treino', 'pos_treino', 'outro')),
  nome text,
  hora time not null,
  -- 0 = domingo … 6 = sábado, como extract(dow) e Date.getDay()
  dias smallint[] not null default '{0,1,2,3,4,5,6}'
    check (cardinality(dias) > 0 and dias <@ '{0,1,2,3,4,5,6}'::smallint[]),
  avisar boolean not null default true,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.plano_refeicao (pessoa_id);
create trigger plano_refeicao_updated_at before update on public.plano_refeicao
  for each row execute function public.tocar_updated_at();

create table public.plano_item (
  id uuid primary key default gen_random_uuid(),
  plano_refeicao_id uuid not null references public.plano_refeicao(id) on delete cascade,
  alimento_id uuid not null references public.alimento(id),
  quantidade_g numeric not null check (quantidade_g > 0),
  ordem int not null default 0
);
create index on public.plano_item (plano_refeicao_id);

-- Marcação do dia. Apagar a refeição registrada desfaz a marcação.
create table public.plano_checagem (
  id uuid primary key default gen_random_uuid(),
  plano_refeicao_id uuid not null references public.plano_refeicao(id) on delete cascade,
  data date not null,
  status text not null check (status in ('feita', 'pulada')),
  refeicao_id uuid references public.refeicao(id) on delete cascade,
  marcado_por uuid references auth.users(id) on delete set null,
  marcado_em timestamptz not null default now(),
  unique (plano_refeicao_id, data),
  check ((status = 'feita') = (refeicao_id is not null))
);
create index on public.plano_checagem (refeicao_id);

-- Aparelhos que recebem avisos. Um aparelho pertence ao último usuário que ativou os avisos nele.
create table public.push_inscricao (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  aparelho text,
  created_at timestamptz not null default now()
);
create index on public.push_inscricao (user_id);

-- Chaves VAPID (geradas pela função avisos no primeiro uso) e o token que o pg_cron usa para chamá-la.
-- Sem políticas: só o service_role e o postgres leem.
create table public.push_config (
  id int primary key default 1 check (id = 1),
  vapid_publica text,
  vapid_jwk jsonb,
  token_cron text not null default encode(extensions.gen_random_bytes(32), 'hex')
);
insert into public.push_config default values;

-- Avisos já enviados, para não repetir.
create table public.aviso_enviado (
  chave text primary key,
  enviado_em timestamptz not null default now()
);

alter table public.plano_refeicao enable row level security;
alter table public.plano_item enable row level security;
alter table public.plano_checagem enable row level security;
alter table public.push_inscricao enable row level security;
alter table public.push_config enable row level security;
alter table public.aviso_enviado enable row level security;

create policy "familia gerencia" on public.plano_refeicao for all to authenticated
  using (public.pessoa_da_minha_familia(pessoa_id)) with check (public.pessoa_da_minha_familia(pessoa_id));
create policy "segue o plano" on public.plano_item for all to authenticated
  using (exists (select 1 from public.plano_refeicao p where p.id = plano_refeicao_id and public.pessoa_da_minha_familia(p.pessoa_id)))
  with check (exists (select 1 from public.plano_refeicao p where p.id = plano_refeicao_id and public.pessoa_da_minha_familia(p.pessoa_id)));
create policy "segue o plano" on public.plano_checagem for all to authenticated
  using (exists (select 1 from public.plano_refeicao p where p.id = plano_refeicao_id and public.pessoa_da_minha_familia(p.pessoa_id)))
  with check (exists (select 1 from public.plano_refeicao p where p.id = plano_refeicao_id and public.pessoa_da_minha_familia(p.pessoa_id)));
create policy "dono" on public.push_inscricao for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Cria (p_id nulo) ou altera uma refeição do plano com os itens ([{alimento_id, quantidade_g}]) de uma vez.
create or replace function public.salvar_plano_refeicao(
  p_id uuid, p_pessoa uuid, p_tipo text, p_nome text, p_hora time, p_dias smallint[], p_avisar boolean, p_itens jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := p_id;
  it jsonb;
  n int := 0;
begin
  if v_id is null then
    insert into public.plano_refeicao (pessoa_id, tipo, nome, hora, dias, avisar)
      values (p_pessoa, p_tipo, nullif(trim(p_nome), ''), p_hora, p_dias, p_avisar)
      returning id into v_id;
  else
    update public.plano_refeicao
      set tipo = p_tipo, nome = nullif(trim(p_nome), ''), hora = p_hora, dias = p_dias, avisar = p_avisar
      where id = v_id;
    if not found then
      raise exception 'refeição do plano não encontrada';
    end if;
    delete from public.plano_item where plano_refeicao_id = v_id;
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
  return v_id;
end $$;

-- Marca uma refeição do plano no dia. Feita: registra a refeição com os itens do plano ou com os
-- informados em p_itens ([{alimento_id, quantidade_g}]). Pulada: só marca. Remarcar substitui.
create or replace function public.marcar_plano(p_plano uuid, p_data date, p_status text, p_itens jsonb default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_plano public.plano_refeicao;
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
      insert into public.item_refeicao (refeicao_id, alimento_id, quantidade_g)
        select v_ref, alimento_id, quantidade_g from public.plano_item where plano_refeicao_id = p_plano order by ordem;
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

-- Desfaz a marcação do dia, apagando a refeição registrada por ela.
create or replace function public.desmarcar_plano(p_plano uuid, p_data date)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_ref uuid;
begin
  select refeicao_id into v_ref from public.plano_checagem where plano_refeicao_id = p_plano and data = p_data;
  delete from public.plano_checagem where plano_refeicao_id = p_plano and data = p_data;
  if v_ref is not null then
    delete from public.refeicao where id = v_ref;
  end if;
end $$;

-- Liga os avisos neste aparelho para o usuário logado (o aparelho muda de dono se outro já o usava).
create or replace function public.inscrever_push(p_endpoint text, p_p256dh text, p_auth text, p_aparelho text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'entre no app primeiro' using errcode = '42501';
  end if;
  insert into public.push_inscricao (user_id, endpoint, p256dh, auth, aparelho)
    values ((select auth.uid()), p_endpoint, p_p256dh, p_auth, p_aparelho)
    on conflict (endpoint) do update
      set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, aparelho = excluded.aparelho;
end $$;

-- Avisos que vencem agora (com 15 min de tolerância, caso o cron atrase). Cada aviso é reservado em
-- aviso_enviado na mesma chamada, então duas execuções simultâneas não mandam o mesmo aviso.
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
             select string_agg(a.nome_curto || ' ' || trim(to_char(pi.quantidade_g, 'FM999990')) || ' g', ', ' order by pi.ordem)
             from public.plano_item pi
             cross join lateral (select split_part(al.nome, ',', 1) as nome_curto from public.alimento al where al.id = pi.alimento_id) a
             where pi.plano_refeicao_id = pr.id), 'Hora de comer') ||
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
    left join public.meta m on m.pessoa_id = l.pessoa_id and l.dia >= m.inicio and (m.fim is null or l.dia <= m.fim)
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

revoke execute on function public.marcar_plano(uuid, date, text, jsonb), public.desmarcar_plano(uuid, date),
  public.inscrever_push(text, text, text, text),
  public.salvar_plano_refeicao(uuid, uuid, text, text, time, smallint[], boolean, jsonb) from public, anon;
grant execute on function public.marcar_plano(uuid, date, text, jsonb), public.desmarcar_plano(uuid, date),
  public.inscrever_push(text, text, text, text),
  public.salvar_plano_refeicao(uuid, uuid, text, text, time, smallint[], boolean, jsonb) to authenticated;
revoke execute on function public.avisos_devidos(timestamptz) from public, anon, authenticated;
grant execute on function public.avisos_devidos(timestamptz) to service_role;
