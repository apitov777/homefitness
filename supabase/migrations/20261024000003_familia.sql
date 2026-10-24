-- Família no estilo do Compartilhamento Familiar do iCloud.
-- Papéis: organizador (um por família), responsável, adulto e criança. Quem não tem login é dependente.
-- Convite por link, código ou QR (qualquer um com o código entra) ou por e-mail (só aquele e-mail).
-- Cada login fica em uma família só. Quem sai, ou é removido, leva os próprios dados para uma família dele.
-- Os dados do dia a dia (refeições, metas, plano) seguem visíveis para a família; exames seguem privados.

-- ---------------------------------------------------------------------------
-- Papéis
-- ---------------------------------------------------------------------------

alter table public.familia_membro drop constraint familia_membro_papel_check;
update public.familia_membro set papel = case papel when 'dono' then 'organizador' else 'adulto' end;
alter table public.familia_membro
  alter column papel set default 'adulto',
  add constraint familia_membro_papel_check check (papel in ('organizador', 'responsavel', 'adulto', 'crianca'));
create unique index familia_um_organizador on public.familia_membro (familia_id) where papel = 'organizador';
create unique index familia_membro_uma_por_usuario on public.familia_membro (user_id);

create or replace function public.meu_papel(p_familia uuid)
returns text language sql stable security definer set search_path = '' as $$
  select papel from public.familia_membro where familia_id = p_familia and user_id = (select auth.uid());
$$;

-- Organizador e responsáveis convidam, adicionam e apagam dependentes.
create or replace function public.gerencia_familia(p_familia uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.meu_papel(p_familia) in ('organizador', 'responsavel'), false);
$$;

-- ---------------------------------------------------------------------------
-- Convites
-- ---------------------------------------------------------------------------

-- 10 caracteres em base32 de Crockford (sem I, L, O, U): 50 bits, fácil de ditar.
create or replace function public.gerar_codigo_convite()
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  alfabeto constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  b bytea := extensions.gen_random_bytes(10);
  s text := '';
begin
  for i in 0..9 loop
    s := s || substr(alfabeto, (get_byte(b, i) & 31) + 1, 1);
  end loop;
  return s;
end $$;

-- Aceita o código digitado com hífen, espaço, minúsculas e O/I/L no lugar de 0/1.
create or replace function public.normalizar_codigo(p text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(translate(upper(coalesce(p, '')), 'OIL', '011'), '[^0-9A-Z]', '', 'g');
$$;

alter table public.familia_convite
  alter column email drop not null,
  alter column criado_por set default auth.uid(),
  add column codigo text not null unique default public.gerar_codigo_convite(),
  add column papel text not null default 'adulto' check (papel in ('responsavel', 'adulto', 'crianca')),
  add column nome text,
  add column expira_em timestamptz not null default now() + interval '7 days',
  add column recusado_em timestamptz,
  add column aceito_por uuid references auth.users(id) on delete set null,
  drop constraint familia_convite_familia_id_email_key;
-- Um convite em aberto por e-mail; quem saiu pode ser convidado de novo.
create unique index familia_convite_email_aberto on public.familia_convite (familia_id, lower(email))
  where aceito_em is null and recusado_em is null;

-- O que aparece para quem abriu o link, antes mesmo de entrar no app.
create or replace function public.ver_convite(p_codigo text)
returns table (familia text, convidado_por text, nome text, papel text, para_email boolean, situacao text)
language sql stable security definer set search_path = '' as $$
  select f.nome,
         (select p.nome from public.pessoa p where p.user_id = c.criado_por and p.familia_id = c.familia_id),
         coalesce(c.nome, (select p.nome from public.pessoa p where p.id = c.pessoa_id)),
         c.papel,
         c.email is not null,
         case when c.aceito_em is not null then 'usado'
              when c.expira_em < now() then 'expirado'
              else 'valido' end
  from public.familia_convite c
  join public.familia f on f.id = c.familia_id
  where c.codigo = public.normalizar_codigo(p_codigo);
$$;

-- Convites para o e-mail do usuário logado, de outras famílias, ainda sem resposta.
create or replace function public.meus_convites()
returns table (codigo text, familia text, convidado_por text, papel text)
language sql stable security definer set search_path = '' as $$
  select c.codigo, f.nome,
         (select p.nome from public.pessoa p where p.user_id = c.criado_por and p.familia_id = c.familia_id),
         c.papel
  from public.familia_convite c
  join public.familia f on f.id = c.familia_id
  where lower(c.email) = lower((select auth.jwt() ->> 'email'))
    and c.aceito_em is null and c.recusado_em is null and c.expira_em >= now()
    and not exists (select 1 from public.familia_membro m
                    where m.familia_id = c.familia_id and m.user_id = (select auth.uid()))
  order by c.created_at desc;
$$;

create or replace function public.recusar_convite(p_codigo text)
returns void language sql security definer set search_path = '' as $$
  update public.familia_convite set recusado_em = now()
  where codigo = public.normalizar_codigo(p_codigo)
    and lower(email) = lower((select auth.jwt() ->> 'email')) and aceito_em is null;
$$;

-- ---------------------------------------------------------------------------
-- Mudança de família (uso interno)
-- ---------------------------------------------------------------------------

-- Leva a pessoa e tudo o que é dela para outra família. Alimentos próprios da família antiga
-- que ela usou vão como cópia, e as refeições feitas junto ficam com um grupo só dela.
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
      join public.plano_refeicao pr on pr.id = pi.plano_refeicao_id where pr.pessoa_id = p_pessoa)
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
  end loop;

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

  -- Convite para dar login a esta pessoa na família antiga deixa de valer.
  delete from public.familia_convite where pessoa_id = p_pessoa;
  update public.pessoa set familia_id = p_destino where id = p_pessoa;
end $$;

-- Junta a família de origem inteira (pessoas, alimentos, receitas, refeições) na de destino.
create or replace function public._fundir_familia(p_origem uuid, p_destino uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.pessoa set familia_id = p_destino where familia_id = p_origem;
  update public.alimento set familia_id = p_destino where familia_id = p_origem;
  update public.receita set familia_id = p_destino where familia_id = p_origem;
  update public.refeicao_grupo set familia_id = p_destino where familia_id = p_origem;
  delete from public.familia where id = p_origem;
end $$;

-- Tira o login da família atual e cria uma família nova para ele, com a pessoa e os dados dela.
create or replace function public._separar_membro(p_user uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_fam uuid;
  v_pessoa uuid;
  v_nome text;
  v_nova uuid;
begin
  select familia_id into v_fam from public.familia_membro where user_id = p_user;
  select id, nome into v_pessoa, v_nome from public.pessoa where familia_id = v_fam and user_id = p_user;
  insert into public.familia (nome) values ('Família de ' || coalesce(v_nome, 'casa')) returning id into v_nova;
  delete from public.familia_membro where familia_id = v_fam and user_id = p_user;
  insert into public.familia_membro (familia_id, user_id, papel) values (v_nova, p_user, 'organizador');
  if v_pessoa is not null then perform public._mover_pessoa(v_pessoa, v_nova); end if;
  return v_nova;
end $$;

-- ---------------------------------------------------------------------------
-- Ações da família
-- ---------------------------------------------------------------------------

create or replace function public.criar_familia(p_nome_familia text, p_nome_pessoa text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_familia uuid;
begin
  if (select auth.uid()) is null then raise exception 'precisa estar logado'; end if;
  if exists (select 1 from public.familia_membro where user_id = (select auth.uid())) then
    raise exception 'você já está em uma família';
  end if;
  insert into public.familia (nome) values (p_nome_familia) returning id into v_familia;
  insert into public.familia_membro (familia_id, user_id, papel) values (v_familia, (select auth.uid()), 'organizador');
  insert into public.pessoa (familia_id, user_id, nome) values (v_familia, (select auth.uid()), p_nome_pessoa);
  return v_familia;
end $$;

-- Entra na família do convite. Se a pessoa estava sozinha na família dela, a família inteira vem junto
-- (dependentes, alimentos e receitas). Se dividia com mais gente, sai de lá levando os próprios dados.
create or replace function public.aceitar_convite(p_codigo text, p_nome text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower((select auth.jwt() ->> 'email'));
  c public.familia_convite;
  v_atual uuid;
  v_papel_atual text;
  v_minha uuid;
begin
  if v_uid is null then raise exception 'precisa estar logado' using errcode = '42501'; end if;
  select * into c from public.familia_convite where codigo = public.normalizar_codigo(p_codigo) for update;
  if not found then raise exception 'convite não encontrado: confira o código'; end if;
  if c.aceito_em is not null then raise exception 'este convite já foi usado: peça um novo'; end if;
  if c.expira_em < now() then raise exception 'este convite expirou: peça um novo'; end if;
  if c.email is not null and lower(c.email) <> coalesce(v_email, '') then
    raise exception 'este convite foi feito para outro e-mail: entre com o e-mail convidado';
  end if;

  select familia_id, papel into v_atual, v_papel_atual from public.familia_membro where user_id = v_uid;
  if v_atual = c.familia_id then
    update public.familia_convite set aceito_em = now(), aceito_por = v_uid where id = c.id;
    return c.familia_id;
  end if;
  if v_atual is not null then
    select id into v_minha from public.pessoa where familia_id = v_atual and user_id = v_uid;
    if not exists (select 1 from public.familia_membro where familia_id = v_atual and user_id <> v_uid) then
      perform public._fundir_familia(v_atual, c.familia_id);
    elsif v_papel_atual = 'organizador' then
      raise exception 'você organiza outra família com mais pessoas: passe o papel de organizador antes de entrar nesta';
    else
      delete from public.familia_membro where familia_id = v_atual and user_id = v_uid;
      if v_minha is not null then perform public._mover_pessoa(v_minha, c.familia_id); end if;
    end if;
  end if;

  insert into public.familia_membro (familia_id, user_id, papel) values (c.familia_id, v_uid, c.papel);
  if v_minha is null then
    if c.pessoa_id is not null
       and exists (select 1 from public.pessoa where id = c.pessoa_id and familia_id = c.familia_id and user_id is null) then
      update public.pessoa set user_id = v_uid, nome = coalesce(nullif(trim(p_nome), ''), nome) where id = c.pessoa_id;
    else
      insert into public.pessoa (familia_id, user_id, nome)
        values (c.familia_id, v_uid, coalesce(nullif(trim(p_nome), ''), c.nome, split_part(v_email, '@', 1), 'Eu'));
    end if;
  end if;
  update public.familia_convite set aceito_em = now(), aceito_por = v_uid where id = c.id;
  return c.familia_id;
end $$;

-- Ao abrir o app: quem ainda não tem família entra direto pelo convite mais recente do seu e-mail.
-- Quem já tem família vê os convites na tela Família e escolhe.
create or replace function public.aceitar_convites()
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_codigo text;
begin
  if v_uid is null or exists (select 1 from public.familia_membro where user_id = v_uid) then return 0; end if;
  select codigo into v_codigo from public.meus_convites() limit 1;
  if v_codigo is null then return 0; end if;
  perform public.aceitar_convite(v_codigo);
  return 1;
end $$;

create or replace function public.sair_da_familia()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_fam uuid;
  v_papel text;
begin
  select familia_id, papel into v_fam, v_papel from public.familia_membro where user_id = v_uid;
  if v_fam is null then raise exception 'você não está em nenhuma família'; end if;
  if not exists (select 1 from public.familia_membro where familia_id = v_fam and user_id <> v_uid) then
    raise exception 'você é a única pessoa com login nesta família';
  end if;
  if v_papel = 'organizador' then
    raise exception 'passe o papel de organizador para outra pessoa antes de sair';
  end if;
  return public._separar_membro(v_uid);
end $$;

create or replace function public.remover_membro(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_fam uuid := (select familia_id from public.familia_membro where user_id = (select auth.uid()));
begin
  if public.meu_papel(v_fam) is distinct from 'organizador' then
    raise exception 'só o organizador remove pessoas da família' using errcode = '42501';
  end if;
  if p_user = (select auth.uid()) then raise exception 'para sair, use Sair da família'; end if;
  if not exists (select 1 from public.familia_membro where familia_id = v_fam and user_id = p_user) then
    raise exception 'essa pessoa não está na sua família';
  end if;
  perform public._separar_membro(p_user);
end $$;

create or replace function public.mudar_papel(p_user uuid, p_papel text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_fam uuid := (select familia_id from public.familia_membro where user_id = (select auth.uid()));
begin
  if public.meu_papel(v_fam) is distinct from 'organizador' then
    raise exception 'só o organizador muda os papéis' using errcode = '42501';
  end if;
  if p_papel not in ('responsavel', 'adulto', 'crianca') then raise exception 'papel inválido'; end if;
  if p_user = (select auth.uid()) then raise exception 'para deixar de ser organizador, passe o papel para outra pessoa'; end if;
  update public.familia_membro set papel = p_papel where familia_id = v_fam and user_id = p_user;
  if not found then raise exception 'essa pessoa não está na sua família'; end if;
end $$;

create or replace function public.transferir_organizador(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_fam uuid := (select familia_id from public.familia_membro where user_id = (select auth.uid()));
  v_papel text;
begin
  if public.meu_papel(v_fam) is distinct from 'organizador' then
    raise exception 'só o organizador passa o papel' using errcode = '42501';
  end if;
  select papel into v_papel from public.familia_membro where familia_id = v_fam and user_id = p_user and user_id <> v_uid;
  if v_papel is null then raise exception 'essa pessoa não está na sua família'; end if;
  if v_papel = 'crianca' then raise exception 'o organizador precisa ser adulto'; end if;
  update public.familia_membro set papel = 'responsavel' where familia_id = v_fam and user_id = v_uid;
  update public.familia_membro set papel = 'organizador' where familia_id = v_fam and user_id = p_user;
end $$;

-- Membros com login e o e-mail de cada um (como o Apple ID na tela da Família).
create or replace function public.membros_da_familia()
returns table (user_id uuid, papel text, email text, desde timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, m.papel, u.email::text, m.created_at
  from public.familia_membro m
  join auth.users u on u.id = m.user_id
  where m.familia_id = (select familia_id from public.familia_membro where user_id = (select auth.uid()))
  order by m.created_at;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

drop policy "membro edita" on public.familia;
create policy "organizador renomeia" on public.familia for update to authenticated
  using (public.meu_papel(id) = 'organizador') with check (public.meu_papel(id) = 'organizador');

-- Entrar, sair e mudar papel só pelas funções acima.
drop policy "sai da familia" on public.familia_membro;

drop policy "membro gerencia" on public.familia_convite;
create policy "membro le" on public.familia_convite for select to authenticated
  using (public.eh_membro(familia_id));
create policy "quem gerencia convida" on public.familia_convite for insert to authenticated
  with check (
    public.gerencia_familia(familia_id)
    and criado_por = (select auth.uid())
    and aceito_em is null
    and (papel <> 'responsavel' or public.meu_papel(familia_id) = 'organizador')
    and (pessoa_id is null or exists (
      select 1 from public.pessoa p where p.id = pessoa_id and p.familia_id = familia_convite.familia_id and p.user_id is null)));
create policy "quem gerencia renova" on public.familia_convite for update to authenticated
  using (public.gerencia_familia(familia_id) and aceito_em is null)
  with check (
    public.gerencia_familia(familia_id)
    and aceito_em is null
    and (papel <> 'responsavel' or public.meu_papel(familia_id) = 'organizador'));
create policy "quem gerencia cancela" on public.familia_convite for delete to authenticated
  using (public.gerencia_familia(familia_id));

drop policy "membro gerencia" on public.pessoa;
create policy "membro le" on public.pessoa for select to authenticated using (public.eh_membro(familia_id));
create policy "membro edita" on public.pessoa for update to authenticated
  using (public.eh_membro(familia_id)) with check (public.eh_membro(familia_id));
create policy "quem gerencia adiciona dependente" on public.pessoa for insert to authenticated
  with check (public.gerencia_familia(familia_id) and user_id is null);
create policy "quem gerencia apaga dependente" on public.pessoa for delete to authenticated
  using (public.gerencia_familia(familia_id) and user_id is null);

-- ---------------------------------------------------------------------------
-- Permissões das funções
-- ---------------------------------------------------------------------------

revoke execute on function
  public._mover_pessoa(uuid, uuid), public._fundir_familia(uuid, uuid), public._separar_membro(uuid)
  from public, anon, authenticated;

revoke execute on function
  public.meu_papel(uuid), public.gerencia_familia(uuid), public.gerar_codigo_convite(), public.normalizar_codigo(text),
  public.ver_convite(text), public.meus_convites(), public.recusar_convite(text), public.criar_familia(text, text),
  public.aceitar_convite(text, text), public.aceitar_convites(), public.sair_da_familia(), public.remover_membro(uuid),
  public.mudar_papel(uuid, text), public.transferir_organizador(uuid), public.membros_da_familia()
  from public, anon;
grant execute on function
  public.meu_papel(uuid), public.gerencia_familia(uuid), public.gerar_codigo_convite(), public.normalizar_codigo(text),
  public.ver_convite(text), public.meus_convites(), public.recusar_convite(text), public.criar_familia(text, text),
  public.aceitar_convite(text, text), public.aceitar_convites(), public.sair_da_familia(), public.remover_membro(uuid),
  public.mudar_papel(uuid, text), public.transferir_organizador(uuid), public.membros_da_familia()
  to authenticated;
-- Quem abriu o link ainda sem conta vê de quem é o convite.
grant execute on function public.ver_convite(text), public.normalizar_codigo(text) to anon;
