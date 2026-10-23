# homefitness

Sistema pessoal de controle de alimentação e saúde para duas pessoas: registro de refeições, acompanhamento de nutrientes e vitaminas, acompanhamento de exames laboratoriais e a relação entre o que se come e o que os exames mostram.

## Estrutura

```
skills/
└── nutricao-saude/        # Skill do Claude com a base de conhecimento do projeto
    ├── SKILL.md           # Princípios e rotinas (perfil, cardápio, registro, exames, avaliação da semana)
    ├── references/
    │   ├── calculos.md    # TMB, TDEE, metas calóricas, macros, água, fibras
    │   ├── nutrientes.md  # Vitaminas e minerais: RDA, fontes brasileiras, deficiências, interações
    │   ├── exames.md      # Marcadores laboratoriais e o que na alimentação influencia cada um
    │   └── modelo-dados.md# Esquema Supabase/Postgres, views, importação da TACO, RLS
    └── scripts/
        └── calc_nutricional.py   # Cálculo determinístico de TMB/TDEE/macros
```

## Stack prevista

- **Banco:** Supabase (Postgres + RLS + Storage para PDFs de exames)
- **Dados de alimentos:** TACO (UNICAMP) e TBCA (USP)
- **Front-end:** a definir

## Uso da skill

Instale a pasta `skills/nutricao-saude` como skill no Claude (ou aponte o Claude Code para este repositório). A skill é acionada em qualquer conversa sobre dieta, cardápio, nutrientes, exames ou evolução do banco de dados do sistema.

Cálculo rápido de metas:

```bash
python skills/nutricao-saude/scripts/calc_nutricional.py \
  --sexo M --idade 35 --peso 85 --altura 178 --atividade moderado --objetivo perder --json
```

## Aviso

O conteúdo da skill é informativo. Faixas de referência variam entre laboratórios; interpretação clínica, prescrição de suplementos e reposição hormonal são do médico.
