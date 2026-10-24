#!/usr/bin/env python3
"""
Baixa da TBCA (Tabela Brasileira de Composição de Alimentos, FCF/USP) a
composição por 100 g e as medidas caseiras de todos os alimentos, para montar
a lista de alimentos de dieta do app (scripts/tbca/gerar_sql.py).

Roda no GitHub Actions (.github/workflows/tbca.yml), porque o site não abre
a partir das sessões do Claude. Grava data/tbca/tbca.jsonl, um alimento por
linha:

  {"codigo": "BRC0001C", "descricao": "Abacate, polpa, in natura, Brasil",
   "grupo": "C - Frutas e derivados", "tipo": "A - Alimento in natura", "marca": "",
   "nutrientes": {"Energia|kcal": 76, "Proteína|g": 1.15, "Vitamina D|mcg": null, ...},
   "medidas": [{"nome": "Colher sopa cheia", "quantidade": 45, "unidade": "g"}, ...]}

Valores como na própria TBCA: "tr" (traço) vira 0, "NA"/"-"/vazio vira null.

Uso:
  pip install requests beautifulsoup4
  python scripts/tbca/coletar.py [--limite N] [--atraso 0.5]

A coleta é retomável: o que já está no arquivo não é baixado de novo.
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

LISTAGEM = "https://www.tbca.net.br/base-dados/composicao_alimentos.php"
SAIDA = Path(__file__).resolve().parents[2] / "data" / "tbca" / "tbca.jsonl"
CABECALHOS = {
    "User-Agent": "homefitness/1.0 (uso pessoal; github.com/apitov777/homefitness)",
    "Accept-Language": "pt-BR,pt;q=0.9",
}


def limpo(s):
    s = (s or "").replace("\xa0", " ").replace("−", "-")
    s = re.sub(r"\s+", " ", s).strip()
    return re.sub(r"\s+([,;:.)])", r"\1", s)


def numero(texto):
    t = limpo(texto).lower().strip("*() ")
    if t in ("tr", "traço", "traco"):
        return 0.0
    if t in ("", "na", "nd", "-", "--"):
        return None
    t = re.sub(r"[^\d,.\-]", "", t)
    if "," in t:
        t = t.replace(".", "").replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return None


def medida(cabecalho):
    """'Pedaço/ Unidade/ Fatia (M) (370 g)' -> {'nome': 'Pedaço/ Unidade/ Fatia (M)', 'quantidade': 370, 'unidade': 'g'}"""
    m = re.match(r"^(.*)\(\s*([\d.,]+)\s*(g|mL|ml|l|L)\s*\)\s*$", limpo(cabecalho))
    if not m:
        return {"nome": limpo(cabecalho), "quantidade": None, "unidade": None}
    un = "mL" if m.group(3).lower() == "ml" else m.group(3)
    return {"nome": limpo(m.group(1)), "quantidade": numero(m.group(2)), "unidade": un}


def baixar(sessao, url, tentativas=4):
    for i in range(tentativas):
        try:
            r = sessao.get(url, timeout=40)
            r.raise_for_status()
            if not r.encoding or r.encoding.lower() == "iso-8859-1":
                r.encoding = r.apparent_encoding or "utf-8"
            return r.text
        except requests.RequestException as e:
            if i == tentativas - 1:
                print(f"falhou {url}: {e}", file=sys.stderr)
                return None
            time.sleep(2 ** (i + 1))


def listar(sessao, atraso):
    """Percorre a listagem (100 por página, seguindo o link da próxima) e devolve [(codigo, url)]."""
    vistos, alimentos = set(), []
    url, pagina = LISTAGEM, 1
    while url and pagina < 200:
        html = baixar(sessao, url)
        if html is None:
            break
        sopa = BeautifulSoup(html, "html.parser")
        novos = 0
        for tr in sopa.select("table tbody tr"):
            a = tr.find("a", href=True)
            if not a or "int_composicao_alimentos.php" not in a["href"]:
                continue
            codigo = limpo(a.get_text())
            if codigo in vistos:
                continue
            vistos.add(codigo)
            alimentos.append((codigo, urljoin(url, a["href"])))
            novos += 1
        links = [(limpo(a.get_text()).lower(), urljoin(url, a["href"])) for a in sopa.find_all("a", href=True)
                 if "composicao_alimentos.php" in a["href"] and "pagina=" in a["href"]]
        # "próxima" anda uma página; "»" sozinho pula o bloco de 10 e só serve na última do bloco.
        proxima = next((u for t, u in links if "próxima" in t or "proxima" in t), None) \
            or next((u for t, u in links if "»" in t), None)
        if not novos:
            break
        print(f"listagem: página {pagina}, {len(alimentos)} alimentos", flush=True)
        url, pagina = proxima, pagina + 1
        time.sleep(atraso)
    return alimentos


def detalhe(html):
    sopa = BeautifulSoup(html, "html.parser")
    info = {"codigo": "", "descricao": "", "grupo": "", "tipo": "", "marca": ""}
    h5 = sopa.find("h5")
    if h5:
        texto = limpo(h5.get_text(" "))
        for rotulo, chave in (("Código", "codigo"), ("Grupo", "grupo"), ("Tipo de Alimento", "tipo"),
                              ("Marca", "marca"), ("Descrição", "descricao")):
            m = re.search(rotulo + r":\s*(.*?)(?=\s(?:Código|Grupo|Tipo de Alimento|Nome Científico|Marca|Descrição):|$)", texto)
            if m:
                info[chave] = limpo(m.group(1).split("<<")[0])
    tabela = sopa.find("table", id="tabela1") or sopa.find("table")
    if tabela is None:
        return None
    cab = [limpo(th.get_text(" ")) for th in tabela.select("thead th")]
    i100 = next(i for i, c in enumerate(cab) if re.search(r"100\s*g", c))
    colunas = [(i, medida(c)) for i, c in enumerate(cab) if i > i100]
    nutrientes = {}
    for tr in tabela.select("tbody tr"):
        tds = [limpo(td.get_text(" ")) for td in tr.find_all("td")]
        if len(tds) <= i100:
            continue
        chave = f"{tds[0]}|{tds[1]}"
        nutrientes[chave] = numero(tds[i100])
        # Os valores de cada medida ajudam a saber quantos gramas tem uma medida em mL
        # (gramas = valor na medida / valor em 100 g x 100).
        if chave in ("Energia|kcal", "Umidade|g", "Proteína|g", "Lipídios|g", "Carboidrato total|g"):
            for i, m in colunas:
                m.setdefault("valores", {})[chave] = numero(tds[i]) if i < len(tds) else None
    info["nutrientes"] = nutrientes
    info["medidas"] = [m for _, m in colunas]
    return info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limite", type=int, default=0)
    ap.add_argument("--atraso", type=float, default=0.5)
    args = ap.parse_args()

    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    feitos = set()
    if SAIDA.exists():
        for linha in SAIDA.read_text(encoding="utf-8").splitlines():
            if linha.strip():
                feitos.add(json.loads(linha)["codigo"])

    sessao = requests.Session()
    sessao.headers.update(CABECALHOS)
    lista = listar(sessao, args.atraso)
    if not lista:
        sys.exit("nenhum alimento na listagem (o site mudou?)")
    faltam = [x for x in lista if x[0] not in feitos]
    if args.limite:
        faltam = faltam[: args.limite]
    print(f"{len(lista)} na TBCA, {len(feitos)} já baixados, baixando {len(faltam)}", flush=True)

    with SAIDA.open("a", encoding="utf-8") as f:
        for n, (codigo, url) in enumerate(faltam, 1):
            html = baixar(sessao, url)
            d = detalhe(html) if html else None
            if d is None:
                print(f"sem tabela: {codigo}", file=sys.stderr)
            else:
                d["codigo"] = d["codigo"] or codigo
                f.write(json.dumps(d, ensure_ascii=False) + "\n")
                f.flush()
            if n % 100 == 0:
                print(f"{n}/{len(faltam)}", flush=True)
            time.sleep(args.atraso)


if __name__ == "__main__":
    main()
