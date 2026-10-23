#!/usr/bin/env python3
"""
Gera a migration SQL com os alimentos da TACO 4ª edição (NEPA/UNICAMP, 2011)
a partir da planilha original em data/taco/Taco_4a_edicao_2011.xls.

Uso:
  pip install xlrd
  python scripts/importar_taco.py > supabase/migrations/20261023000003_taco.sql

Tratamento dos valores (igual ao descrito na própria TACO):
  NA (não aplicável), * (em reavaliação) e vazio -> sem registro
  Tr (traço, entre 0 e o limite de quantificação) -> 0
Ômega-3 é a soma dos ácidos graxos n-3 da TACO (18:3 n-3, 20:5, 22:5, 22:6).
"""
import json
import sys
from pathlib import Path

import xlrd

PLANILHA = Path(__file__).resolve().parent.parent / "data" / "taco" / "Taco_4a_edicao_2011.xls"

# coluna da aba "CMVCol taco3" -> codigo em public.nutriente
COLUNAS_CMV = {
    3: "energia", 5: "proteina", 6: "gordura", 7: "colesterol", 8: "carboidrato", 9: "fibra",
    11: "calcio", 12: "magnesio", 14: "manganes", 15: "fosforo", 16: "ferro", 17: "sodio",
    18: "potassio", 19: "cobre", 20: "zinco", 23: "vit_a", 24: "b1", 25: "b2", 26: "b6",
    27: "b3", 28: "vit_c",
}
# coluna da aba "AGtaco3"
COLUNAS_AG = {2: "gordura_saturada", 3: "gordura_mono", 4: "gordura_poli"}
COLUNAS_N3 = (18, 20, 21, 22)  # 18:3 n-3, 20:5, 22:5, 22:6

# Erros de digitação conhecidos na planilha original.
CORRECOES = {",0,02": 0.02}  # alimento 373, piridoxina


def valor(celula):
    v = celula.value
    if isinstance(v, float):
        return v
    v = str(v).strip()
    if v in CORRECOES:
        return CORRECOES[v]
    if v == "Tr":
        return 0.0
    if v in ("", "NA", "*"):
        return None
    raise ValueError(f"valor inesperado na TACO: {v!r}")


def sql_texto(s):
    return "'" + s.replace("'", "''") + "'"


def main():
    livro = xlrd.open_workbook(str(PLANILHA))
    cmv, ag = livro.sheet_by_index(0), livro.sheet_by_index(1)

    alimentos = []    # (codigo, nome, categoria)
    nutrientes = []   # (codigo, nutriente, valor)
    categoria = None
    for r in range(3, cmv.nrows):
        c0 = cmv.cell_value(r, 0)
        if isinstance(c0, str):
            # linha de grupo (ex.: "Cereais e derivados") ou cabeçalho repetido
            if c0.strip() and c0.strip() not in ("Número do", "Alimento") and not str(cmv.cell_value(r, 1)).strip():
                categoria = c0.strip()
            continue
        codigo = str(int(c0))
        alimentos.append((codigo, " ".join(str(cmv.cell_value(r, 1)).split()), categoria))
        for c, nut in COLUNAS_CMV.items():
            v = valor(cmv.cell(r, c))
            if v is not None:
                nutrientes.append((codigo, nut, round(v, 0 if nut == "energia" else 2)))

    codigos = {a[0] for a in alimentos}
    for r in range(3, ag.nrows):
        c0 = ag.cell_value(r, 0)
        if not isinstance(c0, float):
            continue
        codigo = str(int(c0))
        if codigo not in codigos:
            continue
        for c, nut in COLUNAS_AG.items():
            v = valor(ag.cell(r, c))
            if v is not None:
                nutrientes.append((codigo, nut, round(v, 2)))
        n3 = [valor(ag.cell(r, c)) for c in COLUNAS_N3]
        if any(v is not None for v in n3):
            nutrientes.append((codigo, "omega3", round(sum(v for v in n3 if v is not None), 2)))

    # Saída compacta: um JSON com [codigo, nome, indice_categoria, [valores na ordem de ORDEM]].
    ordem = list(COLUNAS_CMV.values()) + list(COLUNAS_AG.values()) + ["omega3"]
    categorias = sorted({a[2] for a in alimentos})
    por_alimento = {a[0]: [None] * len(ordem) for a in alimentos}
    for cod, nut, val in nutrientes:
        por_alimento[cod][ordem.index(nut)] = val
    linhas = [
        [cod, nome, categorias.index(cat) + 1, [num(v) for v in por_alimento[cod]]]
        for cod, nome, cat in alimentos
    ]
    dados = ",\n".join(json.dumps(l, ensure_ascii=False, separators=(",", ":")) for l in linhas)
    assert "$taco$" not in dados

    out = sys.stdout
    out.write("-- Gerado por scripts/importar_taco.py a partir de data/taco/Taco_4a_edicao_2011.xls (NEPA/UNICAMP).\n")
    out.write(f"-- {len(alimentos)} alimentos, {len(nutrientes)} valores por 100 g. Não editar à mão.\n")
    out.write("-- Cada linha: [codigo TACO, nome, categoria (1-based), [valores por 100 g na ordem de cols]].\n\n")
    out.write("with dados as (select $taco$[\n" + dados + "\n]$taco$::jsonb as j),\n")
    out.write("cats as (select array[" + ", ".join(sql_texto(c) for c in categorias) + "] as c),\n")
    out.write("cols as (select array[" + ", ".join(sql_texto(c) for c in ordem) + "] as n),\n")
    out.write("""ins as (
  insert into public.alimento (nome, categoria, fonte, codigo_fonte)
  select e ->> 1, (select c from cats)[(e ->> 2)::int], 'TACO', e ->> 0
  from dados, jsonb_array_elements(dados.j) e
  on conflict (fonte, codigo_fonte) do update set nome = excluded.nome, categoria = excluded.categoria
  returning id, codigo_fonte)
insert into public.alimento_nutriente (alimento_id, nutriente_id, valor_por_100g)
select ins.id, n.id, (e -> 3 ->> (k - 1))::numeric
from dados
cross join jsonb_array_elements(dados.j) e
join ins on ins.codigo_fonte = e ->> 0
cross join generate_subscripts((select n from cols), 1) k
join public.nutriente n on n.codigo = (select n from cols)[k]
where e -> 3 ->> (k - 1) is not null
on conflict (alimento_id, nutriente_id) do update set valor_por_100g = excluded.valor_por_100g;
""")


def num(v):
    if v is None:
        return None
    return int(v) if float(v).is_integer() else v

if __name__ == "__main__":
    main()
