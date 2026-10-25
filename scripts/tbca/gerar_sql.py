#!/usr/bin/env python3
"""
Gera a migration com a lista de alimentos de dieta a partir da TBCA baixada
(data/tbca/tbca.jsonl, ver coletar.py) e da lista curada (scripts/tbca/lista.txt).

Uso:
  python scripts/tbca/gerar_sql.py > supabase/migrations/20261025000001_alimentos_dieta.sql

Cada linha da lista aponta um código da TBCA. Os valores por 100 g e as medidas caseiras vêm
da TBCA sem mudança; medidas em mL viram gramas pela própria TBCA (valor na
medida / valor em 100 g). Na saída de erro sai a conferência: linhas sem
alimento e alimentos cuja energia não fecha com P×4 + C×4 + G×9 (Atwater).
"""
import json
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
TBCA = Path(__import__("os").environ.get("TBCA_JSONL") or RAIZ / "data" / "tbca" / "tbca.jsonl")
LISTA = Path(__file__).resolve().parent / "lista.txt"

# componente|unidade da TBCA -> codigo em public.nutriente
NUTRIENTES = {
    "Energia|kcal": "energia", "Proteína|g": "proteina", "Carboidrato total|g": "carboidrato",
    "Lipídios|g": "gordura", "Fibra alimentar|g": "fibra", "Colesterol|mg": "colesterol",
    "Ácidos graxos saturados|g": "gordura_saturada", "Ácidos graxos monoinsaturados|g": "gordura_mono",
    "Ácidos graxos poliinsaturados|g": "gordura_poli", "Cálcio|mg": "calcio", "Ferro|mg": "ferro",
    "Sódio|mg": "sodio", "Magnésio|mg": "magnesio", "Fósforo|mg": "fosforo", "Potássio|mg": "potassio",
    "Manganês|mg": "manganes", "Zinco|mg": "zinco", "Cobre|mg": "cobre", "Selênio|mcg": "selenio",
    "Vitamina A (RAE)|mcg": "vit_a", "Vitamina D|mcg": "vit_d", "Alfa-tocoferol (Vitamina E)|mg": "vit_e",
    "Tiamina|mg": "b1", "Riboflavina|mg": "b2", "Niacina|mg": "b3", "Vitamina B6|mg": "b6",
    "Vitamina B12|mcg": "b12", "Vitamina C|mg": "vit_c", "Equivalente de folato|mcg": "b9",
    "Álcool|g": "alcool", "Umidade|g": "agua",
}

# Nomes das medidas da TBCA em português corrido, para os botões do app.
NOMES_MEDIDA = [
    (r"^Pedaço/ ?Unidade/ ?Fatia \((P|M|G)\)$", lambda m: {"P": "Unidade pequena", "M": "Unidade média", "G": "Unidade grande"}[m.group(1)]),
    (r"^Colher sopa (cheia|rasa)$", lambda m: f"Colher de sopa {m.group(1)}"),
    (r"^Colher chá (cheia|rasa)$", lambda m: f"Colher de chá {m.group(1)}"),
    (r"^Colher sobremesa (cheia|rasa)$", lambda m: f"Colher de sobremesa {m.group(1)}"),
    (r"^Colher servir (cheia|rasa)$", lambda m: f"Colher de servir {m.group(1)}"),
    (r"^Copo americano duplo$", lambda m: "Copo americano duplo"),
    (r"^Copo americano pequeno$", lambda m: "Copo americano pequeno"),
    (r"^Xícara chá$", lambda m: "Xícara de chá"),
    (r"^Xícara café$", lambda m: "Xícara de café"),
]

# Medida que já vem marcada ao escolher o alimento: a primeira desta ordem que o alimento tiver.
PREFERIDAS = [
    "Unidade média", "Porção média", "Colher de servir cheia", "Escumadeira média", "Concha média",
    "Colher de sopa cheia", "Copo americano duplo", "Xícara de chá", "Fatia média",
]


def nome_medida(nome):
    for rx, f in NOMES_MEDIDA:
        m = re.match(rx, nome)
        if m:
            return f(m)
    return nome[:1].upper() + nome[1:]


def gramas(medida, nutrientes):
    """Gramas de uma medida: direto quando a TBCA dá em g; em mL, pela razão valor na medida / valor em 100 g."""
    q, un = medida.get("quantidade"), medida.get("unidade")
    if not q:
        return None
    if un == "g":
        return q
    razoes = []
    for chave, v in (medida.get("valores") or {}).items():
        base = nutrientes.get(chave)
        if v and base and base >= 1:
            razoes.append((base, v / base * 100))
    if not razoes:
        return None
    return max(razoes)[1]  # o componente de maior valor dá a razão mais precisa


def medidas_do(alimento):
    vistas, saida = set(), []
    for m in alimento.get("medidas") or []:
        g = gramas(m, alimento["nutrientes"])
        nome = nome_medida(m["nome"])
        if not g or nome in vistas or g > 1000:
            continue
        vistas.add(nome)
        saida.append({"nome": nome, "g": round(g) if g >= 10 else round(g, 1)})
    saida.sort(key=lambda x: (PREFERIDAS.index(x["nome"]) if x["nome"] in PREFERIDAS else len(PREFERIDAS), x["g"]))
    # "Unidade média" e "Porção média" de 50 g no ovo: fica só a primeira
    sem_repetir = []
    for m in saida:
        if all(m["g"] != x["g"] for x in sem_repetir):
            sem_repetir.append(m)
    return sem_repetir[:6]


def main():
    tbca = [json.loads(l) for l in TBCA.read_text(encoding="utf-8").splitlines() if l.strip()]
    lista = []
    for linha in LISTA.read_text(encoding="utf-8").splitlines():
        if linha.strip() and not linha.startswith("#"):
            lista.append(linha.split("|", 2))

    por_codigo = {a["codigo"]: a for a in tbca}
    escolhidos, faltam, usados = [], [], {}
    for grupo, nome, codigo in lista:
        a = por_codigo.get(codigo.strip())
        if a is None or a["nutrientes"].get("Energia|kcal") is None:
            faltam.append(f"{nome} ({codigo})")
            continue
        if a["codigo"] in usados:
            print(f"repetido: {nome} = {usados[a['codigo']]} ({a['descricao']})", file=sys.stderr)
            continue
        usados[a["codigo"]] = nome
        escolhidos.append((grupo, nome, a))

    # Conferência de Atwater (só aviso: a TBCA calcula com carboidrato disponível e fatores próprios).
    for _, nome, a in escolhidos:
        n = a["nutrientes"]
        p, c, g, f, al = (n.get(k) or 0 for k in ("Proteína|g", "Carboidrato disponível|g", "Lipídios|g", "Fibra alimentar|g", "Álcool|g"))
        calc = 4 * p + 4 * c + 9 * g + 2 * f + 7 * al
        kcal = n["Energia|kcal"]
        if abs(calc - kcal) > max(20, 0.15 * kcal):
            print(f"energia não fecha: {nome}: TBCA {kcal:.0f} kcal, P/C/G dão {calc:.0f} ({a['codigo']} {a['descricao']})", file=sys.stderr)
    print(f"{len(escolhidos)} alimentos; sem correspondência na TBCA: {', '.join(faltam) or 'nenhum'}", file=sys.stderr)

    ordem = list(dict.fromkeys(NUTRIENTES.values()))
    grupos = list(dict.fromkeys(g for g, _, _ in escolhidos))
    linhas = []
    for grupo, nome, a in escolhidos:
        valores = [None] * len(ordem)
        for chave, cod in NUTRIENTES.items():
            v = a["nutrientes"].get(chave)
            if v is not None:
                valores[ordem.index(cod)] = int(v) if float(v).is_integer() else v
        linhas.append([a["codigo"], nome, grupos.index(grupo) + 1, a["descricao"], medidas_do(a), valores])
    dados = ",\n".join(json.dumps(l, ensure_ascii=False, separators=(",", ":")) for l in linhas)
    assert "$tbca$" not in dados

    out = sys.stdout
    out.write("-- Lista de alimentos de dieta: alimentos da TBCA (FCF/USP, www.tbca.net.br) com nome simples e medidas caseiras.\n")
    out.write("-- Gerado por scripts/tbca/gerar_sql.py a partir de data/tbca/tbca.jsonl e scripts/tbca/lista.txt. Não editar à mão.\n")
    out.write(f"-- {len(linhas)} alimentos. Cada linha: [codigo TBCA, nome no app, grupo (1-based), descrição na TBCA, medidas, [valores por 100 g na ordem de cols]].\n\n")
    out.write("alter table public.alimento add column if not exists lista_dieta boolean not null default false;\n")
    out.write("alter table public.alimento add column if not exists descricao_fonte text;\n")
    out.write("comment on column public.alimento.lista_dieta is 'Da lista de alimentos de dieta (TBCA com nome simples e medidas caseiras); vem antes na busca.';\n")
    out.write("comment on column public.alimento.descricao_fonte is 'Descrição original na tabela de origem (TBCA), quando o nome no app é simplificado.';\n\n")
    out.write("with dados as (select $tbca$[\n" + dados + "\n]$tbca$::jsonb as j),\n")
    out.write("grupos as (select array[" + ", ".join("'" + g.replace("'", "''") + "'" for g in grupos) + "] as g),\n")
    out.write("cols as (select array[" + ", ".join(f"'{c}'" for c in ordem) + "] as n),\n")
    out.write("""ins as (
  insert into public.alimento (nome, categoria, fonte, codigo_fonte, descricao_fonte, medidas_caseiras, lista_dieta)
  select e ->> 1, (select g from grupos)[(e ->> 2)::int], 'TBCA', e ->> 0, e ->> 3, e -> 4, true
  from dados, jsonb_array_elements(dados.j) e
  on conflict (fonte, codigo_fonte) do update set
    nome = excluded.nome, categoria = excluded.categoria, descricao_fonte = excluded.descricao_fonte,
    medidas_caseiras = excluded.medidas_caseiras, lista_dieta = true, ativo = true
  returning id, codigo_fonte)
insert into public.alimento_nutriente (alimento_id, nutriente_id, valor_por_100g)
select ins.id, n.id, (e -> 5 ->> (k - 1))::numeric
from dados
cross join jsonb_array_elements(dados.j) e
join ins on ins.codigo_fonte = e ->> 0
cross join generate_subscripts((select n from cols), 1) k
join public.nutriente n on n.codigo = (select n from cols)[k]
where e -> 5 ->> (k - 1) is not null
on conflict (alimento_id, nutriente_id) do update set valor_por_100g = excluded.valor_por_100g;
""")


if __name__ == "__main__":
    main()
