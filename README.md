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

## Stack

- **Banco:** Supabase, projeto `homefitness` (região São Paulo), Postgres + RLS por família.
- **Dados de alimentos:** TACO 4ª edição (NEPA/UNICAMP), 597 alimentos importados da planilha original em `data/taco/`; a **lista de alimentos de dieta** (≈ 450 alimentos da TBCA/USP com nome simples e medidas caseiras, ver abaixo); alimentos de rótulo cadastrados pelo app, digitando ou pela foto da tabela nutricional.
- **Front-end:** PWA (React + Vite) em `app/`, instalável no iPhone pela Tela de Início. Depois pode virar app nativo SwiftUI com o app Saúde usando o mesmo banco.

## App (`app/`)

```bash
cd app
npm install
npm run dev      # usa .env.production (URL e chave publishable do projeto)
npm test         # cálculo de metas (conferido contra o script Python) e contas da semana
npm run build    # gera app/dist para publicar
```

Telas: **Hoje** (a meta do dia da família em cima: um anel por pessoa com o que comeu contra a própria meta e quantas refeições do plano já fez; embaixo, a pessoa aberta com as barras de energia e macros, o registro rápido e o que registrou no dia, mais os micronutrientes), **Plano** (Dietas, Semana, Refeições e Treinos; avisos no celular), **Receitas** (catálogo de receitas fitness e doces saudáveis e itens avulsos, com ingredientes, preparo e nutrientes; o ♡ marca as favoritas de cada pessoa, que são as que entram na Semana; "Registrar à mão" e o botão em Hoje abrem **Registrar**, uma refeição para os dois, com gramas por pessoa), **Exames** (resultados, faixa do laudo e o que na alimentação mexe em cada marcador) e **Perfil** (dados, meta calculada com a fórmula visível, privacidade dos exames, alimentos de rótulo e a entrada da **Família**).

Login com e-mail e senha; a sessão fica salva, então depois da primeira vez o app abre direto.

**Plano**, para programar a semana ou o mês:
- Dietas: um dia inteiro de refeições para a pessoa, ligado à meta do dia. Cada dieta tem nome, alvo de kcal (vem da meta da pessoa) e os dias da semana em que vale (um dia tem uma dieta só; marcar um dia numa dieta tira dele a outra). Escolhe-se quantas refeições o dia tem (3 a 6, com horários e uma fatia do alvo para cada uma, que dá para mudar) e, em cada refeição, as opções A, B e C: receitas das favoritas da semana ou alimentos, com as gramas e o kcal/100 g de cada item. O editor mostra as kcal de cada opção contra o alvo da refeição (na faixa = até 10% de diferença), "Ajustar para o alvo" escala as gramas e "Sugerir opções" monta opções com as favoritas que servem para aquela refeição. O cartão da dieta diz se a opção A de cada refeição fecha a meta média dos dias marcados (±5%). Em Hoje, a refeição da dieta mostra as opções com as kcal; toca-se na que comeu e em "Fiz a B", que registra os itens dela (ou "Ajustar gramas" com os itens da opção).
- Refeições: o plano de sempre, com horário, dias da semana e gramas de cada alimento. As refeições de uma dieta aparecem aqui com a etiqueta da dieta e o número de opções; editar muda só a opção A.
- Receitas ficam na aba própria: o catálogo (43 receitas montadas só com alimentos da TACO e 23 itens avulsos como "Chocolate meio amargo, 30 g") e as da família, com os ingredientes em gramas, o modo de preparo, o peso da panela pronta e a porção. O banco calcula 100 g da receita e ela vira um alimento (as da família aparecem também em Registrar). O detalhe mostra energia, macros, vitaminas e minerais por porção e o % da recomendação diária da pessoa. "Adaptar à minha" copia uma receita do catálogo para a família editar. Cada receita tem foto: as do catálogo vêm do Wikimedia Commons (licença livre, com o crédito no detalhe) e as da família podem ser tiradas com a câmera no editor (ficam guardadas só para a família). O cartão mostra kcal, porção e as barras de proteína, carboidrato e gordura contra a meta da pessoa; o detalhe, o anel de calorias com o % do dia. O ♡ guarda a receita nas **Favoritas da semana** da pessoa: elas ficam numa tira no topo de Receitas e aparecem prontas, com um toque e a porção de cada um, em Registrar e no editor de refeição do Plano (as que servem para aquela refeição primeiro); a Semana monta o cardápio com elas.
- Treinos: atividade, minutos e dias. Gasto por sessão = calorias ativas do relógio, ou (MET − 1) × peso × horas (MET do Compendium of Physical Activities). A meta do dia pode ser fixa ou acompanhar o treino: (TMB × fator da rotina + treino) × meta/gasto do cadastro, nunca abaixo da TMB, com a diferença no carboidrato.
- Semana e Mês: cada dia com as refeições, o treino, o planejado contra a meta do dia (fecha em ±5%) e o gasto. "Montar com receitas" reveza as receitas da família e as favoritas de cada pessoa nos dias e refeições marcados, a mesma panela para quem estiver junto e as gramas de cada um fechando a própria meta do dia. Tocar numa refeição troca só aquele dia (receita, gramas, outros alimentos, "Mesma panela" para outra pessoa) ou volta ao plano de sempre. O saldo do período mostra planejado, meta, gasto e o déficit em kcal (≈ kg pela estimativa de 7.700 kcal/kg).
- Compras: quanto cozinhar de cada receita no período (em kg e em número de receitas) e a lista de compras por categoria, com as receitas abertas nos ingredientes; "Enviar" manda pela folha de compartilhar.
- Hoje usa o cardápio do dia, a meta do dia e mostra o treino do dia.

**Hoje**, o dia de cada um:
- Meta do dia da família: um cartão por pessoa com o anel (kcal comidas contra a meta do dia dela, "falta 760 kcal", "na meta" entre 90% e 110% ou "passou"), e "1 de 2 do plano". Tocar na pessoa abre o dia dela embaixo; quem está logado vem aberto.
- Registro rápido: cada refeição do plano (da dieta do dia) com as opções A/B/C e três botões. "Fiz a B" registra a opção; "Comi outra coisa" abre ali mesmo as favoritas da semana (um toque, na porção) e a busca de alimentos, com as gramas de cada item, e registra o que comeu no lugar (a checagem fica "trocada", que conta como feita no resumo da noite); "Não fiz" pula. "Ajustar gramas" continua para comer a opção com outras quantidades.
- "＋ Comi algo a mais": o que entrou fora do plano (um lanche, uma sobremesa), escolhendo a refeição e o alimento do mesmo jeito; fica na lista do dia com o selo "a mais". O botão "＋ Registrar refeição" segue para registrar à mão, inclusive para os dois.

**Família** (Perfil › Família), no estilo do Compartilhamento Familiar do iCloud:
- Membros com papel: organizador (um por família), responsável, adulto e criança; quem não tem login é dependente.
- Convidar: o app gera um link, um código de 10 caracteres e um QR. O link sai pela folha de compartilhar do celular (iMessage, WhatsApp, e-mail). Com e-mail, só aquela conta aceita e ela entra direto ao criar a conta.
- Quem aceita ganha o próprio espaço (meta, plano, avisos) e o cadastro guiado abre sozinho. Dependente pode ganhar login depois ("Dar login").
- Sair ou ser removido leva os próprios dados para uma família nova. Quem entra estando sozinho em outra família traz a família inteira junto.
- Nenhum app consegue ler a lista da Família do iCloud nem do Google; por isso o convite é por link, código ou QR.
- Android: o mesmo app; botão "Instalar o app" quando o Chrome oferece, e "Escolher dos contatos" no convite (Contact Picker do Chrome).

**Lista de alimentos de dieta** (`scripts/tbca/`): os alimentos que costumam entrar numa dieta (arroz, feijão, carnes, ovos, laticínios, frutas, verduras, pães, bebidas, doces e pratos prontos), com os valores por 100 g da TBCA (Tabela Brasileira de Composição de Alimentos, FCF/USP) sem mudança e as medidas caseiras da própria TBCA em gramas (colher de sopa cheia, unidade média, copo americano...). `lista.txt` tem uma linha por alimento: grupo, nome no app e a regex da descrição na TBCA. `coletar.py` baixa a TBCA inteira para `data/tbca/tbca.jsonl` e roda pelo workflow `tbca.yml` (o site não abre das sessões do Claude); `gerar_sql.py` monta a migration `supabase/migrations/20261025000001_alimentos_dieta.sql` e avisa quando a energia de um alimento não fecha com P×4 + C×4 + G×9. No app, a busca traz esses alimentos logo depois dos da família; ao escolher um, as gramas já vêm na medida mais comum e os botões de medida trocam as gramas com um toque. O carboidrato é o total da TBCA (com a fibra), como na TACO.

**Alimento pelo rótulo** (Perfil): "Fotografar a tabela nutricional" lê a foto no próprio celular (Tesseract, em português; ≈ 3 MB baixados na primeira vez) e preenche porção, medida da porção e os números, por porção ou por 100 g (rótulo novo, RDC 429/2020). O que foi lido fica em verde para conferir com a embalagem antes de cadastrar; nada é estimado. A porção do rótulo vira a medida caseira do alimento.

**Fotos do catálogo** (`scripts/fotos/`): `receitas.json` lista cada receita com os termos de busca no Wikimedia Commons e, quando já escolhida, o arquivo fixado (`arquivo`). `baixar.mjs` pega até 4 candidatos por receita (só JPEG/PNG com licença livre), recorta a escolhida em 800×600 para `app/public/fotos/<slug>.jpg`, grava o crédito em `app/public/fotos/creditos.json` e monta folhas de contato (`scripts/fotos/contato-N.jpg`) para conferir. Roda pelo workflow `fotos.yml` (Actions › Fotos do catálogo › Run workflow; o campo `refazer` aceita slugs separados por vírgula ou `todos`), que faz o commit na branch escolhida. Foto de receita da família não passa por aqui: vai para o Storage pelo app.

## Banco (`supabase/`)

- `migrations/` na ordem: esquema e RLS, referências (nutrientes, recomendações, marcadores), TACO, função de ingestão antes do exame.
- Regras de acesso: tudo é por família (`familia_membro`); exames só a própria pessoa vê, a menos que ela marque `compartilha_exames`; só a própria pessoa muda o login e essa opção (trigger `proteger_pessoa`).
- Uma refeição feita junto vira um `refeicao_grupo` com uma `refeicao` por pessoa, cada uma com as próprias gramas (`registrar_refeicao`).
- Plano de refeições: `plano_refeicao` + `plano_item` (gramas por alimento) por pessoa. Marcar no dia (`marcar_plano`) registra a refeição com os itens do plano ou com as gramas ajustadas e grava `plano_checagem`; apagar a refeição desfaz a marcação. Meta batida = energia entre 90% e 110% da meta.
- Avisos: a função `functions/avisos` manda Web Push (chaves VAPID geradas no primeiro uso e guardadas em `push_config`). O `pg_cron` chama a função a cada minuto (`20261024000002_avisos_cron.sql`) e `avisos_devidos()` devolve o que vence: cada refeição do plano com sino ligado e ainda não marcada, e o resumo do dia no horário de `pessoa.aviso_resumo` (padrão 21:30). No iPhone o aviso só chega com o app instalado na Tela de Início.
- Semana (`20261024000004_semana.sql`): `receita.tipos` (em que refeições entra) e `salvar_receita` (recalcula `alimento_nutriente` da receita; se ela já foi comida, cria uma versão nova e o histórico fica com a antiga). `plano_dia` + `plano_dia_item` trocam os itens de uma refeição do plano num dia (`definir_dias`); `marcar_plano` e os avisos usam o cardápio do dia. `treino_plano` e `metas_do_periodo(pessoas, de, até)` dão a meta, o gasto e o treino de cada dia (até 62 dias por chamada).
- Catálogo (`20261024000005_catalogo.sql`): `receita.familia_id` nulo = receita do catálogo, que todo mundo lê e ninguém edita (para mudar, copia-se com `salvar_receita`); `porcao_g`, `descricao` e `tags`. `receita_favorita` (pessoa × receita) guarda as favoritas de cada um. A semente monta 43 receitas a partir de alimentos da TACO (`_calcular_receita` faz a conta por 100 g) e 23 itens avulsos, que apontam direto para o alimento da TACO numa porção.
- Fotos (`20261024000006_fotos.sql`): `receita.foto`. No catálogo é o arquivo estático do app (`fotos/<slug>.jpg`); na família é o objeto do bucket privado `fotos` do Storage, em `<familia_id>/<receita_id>.jpg` (5 MB, JPEG/PNG/WebP), com políticas que deixam cada família ler, enviar, trocar e apagar só a própria pasta. O app abre a foto por URL assinada de 1 hora e reduz a imagem a 1200 px antes de enviar.
- Dietas (`20261024000007_dietas.sql`): `dieta` (pessoa, nome, `kcal_alvo`, `dias` da semana; `salvar_dieta` tira os dias escolhidos das outras dietas da pessoa e `apagar_dieta` leva as refeições dela). As refeições da dieta são `plano_refeicao` normais com `dieta_id` e `kcal_alvo` (dias e ativo seguem a dieta; sem dia marcado ficam inativas): a opção A fica em `plano_item` e as outras em `plano_opcao` + `plano_opcao_item`. `salvar_plano_refeicao` ganhou `p_dieta`, `p_kcal_alvo` e `p_opcoes` (`[{nome, itens:[{alimento_id, quantidade_g}]}]`, cada opção com pelo menos um item) e `marcar_plano` ganhou `p_opcao`: feita com uma opção registra os itens dela e guarda `plano_checagem.opcao_id`. Hoje, avisos e Semana seguem usando a opção A.
- Hoje (`20261024000008_hoje.sql`): `plano_checagem.status` aceita `trocada` (comeu outra coisa no lugar; `refeicao_id` traz o que comeu). `marcar_plano` com `p_status = 'trocada'` exige `p_itens`; `avisos_devidos` conta a trocada como feita no resumo. "Comi algo a mais" é um `registrar_refeicao` comum com a descrição `A mais` no `refeicao_grupo`.
- Família (`20261024000003_familia.sql`): papéis em `familia_membro.papel`, um login em uma família só, convites com `codigo`, `papel`, `expira_em` (7 dias). Entrar, sair, remover, mudar papel e passar o organizador só pelas funções `aceitar_convite`, `sair_da_familia`, `remover_membro`, `mudar_papel` e `transferir_organizador`. `ver_convite` responde até para quem ainda não tem conta.
- `tests/` roda as migrations num Postgres local e confere a RLS com três usuários (`rls.sql`), o plano com os avisos (`plano.sql`), a família (`familia.sql`), a semana com receitas, treinos e meta do dia (`semana.sql`) o catálogo com as favoritas, as fotos e o bucket (`catalogo.sql`) as dietas com as opções (`dietas.sql`) e o registro rápido de Hoje (`hoje.sql`).
- `scripts/importar_taco.py` regenera a migration da TACO a partir da planilha. Na TACO original o leite de vaca integral e o desnatado UHT estão sem energia e macros (amostras em reavaliação); cadastre pelo rótulo.

## Uso da skill

Instale a pasta `skills/nutricao-saude` como skill no Claude (ou aponte o Claude Code para este repositório). A skill é acionada em qualquer conversa sobre dieta, cardápio, nutrientes, exames ou evolução do banco de dados do sistema.

Cálculo rápido de metas:

```bash
python skills/nutricao-saude/scripts/calc_nutricional.py \
  --sexo M --idade 35 --peso 85 --altura 178 --atividade moderado --objetivo perder --json
```

## Aviso

O conteúdo da skill é informativo. Faixas de referência variam entre laboratórios; interpretação clínica, prescrição de suplementos e reposição hormonal são do médico.

## Publicação

O app sai em `https://apitov777.github.io/homefitness/` pelo workflow `.github/workflows/pages.yml`,
a cada push na `main` que mexa em `app/`. Requer o repositório público e, em
Settings › Pages, a fonte "GitHub Actions". No Supabase, Authentication › URL Configuration ›
Site URL deve apontar para esse endereço.
