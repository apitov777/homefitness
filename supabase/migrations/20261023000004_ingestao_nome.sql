-- Versão de ingestao_antes_exame para o app: devolve também o nome do nutriente, quantos dias com
-- registro entraram na média e usa a AI quando não há RDA. A função original continua igual.
create or replace function public.ingestao_antes_exame_detalhe(p_resultado uuid)
returns table (nutriente text, nome text, unidade text, efeito text, media_dia numeric, dias_registrados int, rda numeric, pct_rda numeric)
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
  select n.codigo, n.nome, n.unidade, mn.efeito,
         round(avg(d.total), 1),
         count(d.data)::int,
         max(coalesce(nr.rda, nr.ai)),
         round(100 * avg(d.total) / nullif(max(coalesce(nr.rda, nr.ai)), 0), 0)
  from re
  join public.marcador_nutriente mn on mn.marcador_id = re.marcador_id
  join public.nutriente n on n.id = mn.nutriente_id
  left join public.v_dia_nutriente d on d.pessoa_id = re.pessoa_id and d.nutriente = n.codigo
       and d.data between re.data - re.janela and re.data
  left join public.nutriente_recomendacao nr on nr.nutriente_id = n.id
       and nr.sexo = (select sexo from p) and (select idade from p) between nr.idade_min and nr.idade_max
  group by n.codigo, n.nome, n.unidade, mn.efeito, n.ordem
  order by mn.efeito, n.ordem;
$$;
