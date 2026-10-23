#!/usr/bin/env python3
"""
Cálculo nutricional: TMB (Mifflin-St Jeor ou Katch-McArdle), TDEE, meta calórica e macros.

Uso:
  python calc_nutricional.py --sexo M --idade 35 --peso 85 --altura 178 --atividade moderado --objetivo perder
  python calc_nutricional.py --sexo F --idade 32 --peso 62 --altura 165 --atividade leve --objetivo manter --gordura 28
  python calc_nutricional.py ... --json     # saída em JSON para gravar na tabela meta

Opções de ajuste fino:
  --proteina-gkg 1.8      (padrão depende do objetivo/atividade)
  --gordura-pct 0.30      (fração das calorias; padrão 0.28)
  --deficit 0.18          (fração do TDEE; padrão por objetivo)
"""
import argparse
import json

FATORES = {
    "sedentario": 1.2,
    "leve": 1.375,
    "moderado": 1.55,
    "ativo": 1.725,
    "muito_ativo": 1.9,
}

AJUSTE_OBJETIVO = {   # fração sobre o TDEE
    "manter": 0.0,
    "perder": -0.18,
    "perder_lento": -0.10,
    "ganhar": 0.12,
    "saude": -0.05,
}

PROTEINA_PADRAO = {   # g/kg
    "manter": 1.4,
    "perder": 1.8,
    "perder_lento": 1.8,
    "ganhar": 1.8,
    "saude": 1.4,
}


def tmb_mifflin(sexo, peso, altura, idade):
    base = 10 * peso + 6.25 * altura - 5 * idade
    return base + 5 if sexo == "M" else base - 161


def tmb_katch(peso, gordura_pct):
    massa_magra = peso * (1 - gordura_pct / 100)
    return 370 + 21.6 * massa_magra


def calcular(sexo, idade, peso, altura, atividade, objetivo,
             gordura_pct=None, proteina_gkg=None, gordura_frac=0.28, deficit=None):
    if gordura_pct:
        tmb = tmb_katch(peso, gordura_pct)
        metodo = "katch-mcardle"
    else:
        tmb = tmb_mifflin(sexo, peso, altura, idade)
        metodo = "mifflin-st-jeor"

    tdee = tmb * FATORES[atividade]
    ajuste = AJUSTE_OBJETIVO[objetivo] if deficit is None else -abs(deficit)
    kcal = tdee * (1 + ajuste)
    aviso = []
    if kcal < tmb:
        aviso.append("Meta abaixo da TMB — elevada para a TMB.")
        kcal = tmb
    if abs(ajuste) > 0.25:
        aviso.append("Déficit acima de 25%: só com acompanhamento.")

    p_gkg = proteina_gkg or PROTEINA_PADRAO[objetivo]
    if atividade == "sedentario" and proteina_gkg is None:
        p_gkg = min(p_gkg, 1.2)
    if idade >= 65 and p_gkg < 1.0:
        p_gkg = 1.0
    proteina_g = p_gkg * peso
    gordura_g = max(gordura_frac * kcal / 9, 0.7 * peso)   # nunca abaixo de 0,7 g/kg
    carbo_g = (kcal - proteina_g * 4 - gordura_g * 9) / 4
    if carbo_g < 1.5 * peso:
        aviso.append("Carboidrato ficou baixo (< 1,5 g/kg); considere reduzir proteína ou gordura.")

    fibra_g = 14 * kcal / 1000
    agua_ml = 33 * peso

    return {
        "metodo_tmb": metodo,
        "tmb_kcal": round(tmb),
        "fator_atividade": FATORES[atividade],
        "tdee_kcal": round(tdee),
        "ajuste_objetivo": ajuste,
        "kcal": round(kcal),
        "proteina_g": round(proteina_g),
        "proteina_gkg": round(p_gkg, 2),
        "gordura_g": round(gordura_g),
        "carboidrato_g": round(max(carbo_g, 0)),
        "fibra_g": round(fibra_g),
        "agua_ml": round(agua_ml),
        "avisos": aviso,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sexo", choices=["M", "F"], required=True)
    ap.add_argument("--idade", type=int, required=True)
    ap.add_argument("--peso", type=float, required=True, help="kg")
    ap.add_argument("--altura", type=float, required=True, help="cm")
    ap.add_argument("--atividade", choices=FATORES.keys(), required=True)
    ap.add_argument("--objetivo", choices=AJUSTE_OBJETIVO.keys(), required=True)
    ap.add_argument("--gordura", type=float, help="%% de gordura corporal (usa Katch-McArdle)")
    ap.add_argument("--proteina-gkg", type=float)
    ap.add_argument("--gordura-pct", type=float, default=0.28)
    ap.add_argument("--deficit", type=float)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    r = calcular(a.sexo, a.idade, a.peso, a.altura, a.atividade, a.objetivo,
                 a.gordura, a.proteina_gkg, a.gordura_pct, a.deficit)
    if a.json:
        print(json.dumps(r, ensure_ascii=False, indent=2))
        return
    print(f"TMB ({r['metodo_tmb']}): {r['tmb_kcal']} kcal")
    print(f"TDEE (x{r['fator_atividade']}): {r['tdee_kcal']} kcal")
    print(f"Meta ({r['ajuste_objetivo']:+.0%}): {r['kcal']} kcal")
    print(f"Proteína: {r['proteina_g']} g ({r['proteina_gkg']} g/kg)")
    print(f"Gordura: {r['gordura_g']} g")
    print(f"Carboidrato: {r['carboidrato_g']} g")
    print(f"Fibra: {r['fibra_g']} g | Água: {r['agua_ml']} mL")
    for av in r["avisos"]:
        print("Aviso:", av)


if __name__ == "__main__":
    main()
