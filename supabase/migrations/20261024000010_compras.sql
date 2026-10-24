-- Compra da semana: a lista de compras sai das dietas do plano (calculada no app); aqui só fica o que a família
-- marca nela, igual nos dois celulares: o que já pegou (ou já tem em casa) e qual opção (B, C…) vai fazer em cada
-- refeição naquela semana. Sem escolha, a lista conta a opção A.

create table public.compra_marcada (
  familia_id uuid not null references public.familia(id) on delete cascade,
  -- segunda-feira da semana
  semana date not null check (extract(isodow from semana) = 1),
  alimento_id uuid not null references public.alimento(id) on delete cascade,
  marcado_por uuid default auth.uid() references auth.users(id) on delete set null,
  marcado_em timestamptz not null default now(),
  primary key (familia_id, semana, alimento_id)
);

create table public.compra_opcao (
  familia_id uuid not null references public.familia(id) on delete cascade,
  semana date not null check (extract(isodow from semana) = 1),
  plano_refeicao_id uuid not null references public.plano_refeicao(id) on delete cascade,
  opcao_id uuid not null references public.plano_opcao(id) on delete cascade,
  primary key (familia_id, semana, plano_refeicao_id)
);
create index on public.compra_opcao (plano_refeicao_id);
create index on public.compra_opcao (opcao_id);

alter table public.compra_marcada enable row level security;
alter table public.compra_opcao enable row level security;

create policy "familia gerencia" on public.compra_marcada for all to authenticated
  using (public.eh_membro(familia_id)) with check (public.eh_membro(familia_id));
create policy "familia gerencia" on public.compra_opcao for all to authenticated
  using (public.eh_membro(familia_id))
  with check (public.eh_membro(familia_id) and exists (
    select 1 from public.plano_opcao o join public.plano_refeicao pr on pr.id = o.plano_refeicao_id
    where o.id = opcao_id and o.plano_refeicao_id = compra_opcao.plano_refeicao_id and public.pessoa_da_minha_familia(pr.pessoa_id)));
