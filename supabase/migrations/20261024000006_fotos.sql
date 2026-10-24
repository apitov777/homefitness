-- Fotos: uma por receita. Catálogo: arquivo estático do app (fotos/<slug>.jpg, baixado do Wikimedia Commons
-- pelo scripts/fotos, com crédito em fotos/creditos.json). Família: objeto no bucket privado "fotos" do Storage,
-- no caminho <familia_id>/<receita_id>.jpg, que o app abre por URL assinada.

alter table public.receita add column foto text;

update public.receita r set foto = 'fotos/' || v.slug || '.jpg'
  from (values
    ('Abacate com mel e chocolate', 'abacate-com-mel-e-chocolate'),
    ('Aveia de geladeira com morango', 'aveia-de-geladeira-com-morango'),
    ('Banana com aveia e mel', 'banana-com-aveia-e-mel'),
    ('Bolo de banana com aveia', 'bolo-de-banana-com-aveia'),
    ('Brownie de chocolate meio amargo', 'brownie-de-chocolate-meio-amargo'),
    ('Carne moída com abóbora', 'carne-moida-com-abobora'),
    ('Cookie de banana e aveia', 'cookie-de-banana-e-aveia'),
    ('Creme de maracujá com iogurte', 'creme-de-maracuja-com-iogurte'),
    ('Crepioca de frango', 'crepioca-de-frango'),
    ('Doce de banana sem açúcar', 'doce-de-banana-sem-acucar'),
    ('Escondidinho de frango com mandioca', 'escondidinho-de-frango-com-mandioca'),
    ('Frango com arroz, feijão e salada', 'frango-com-arroz-feijao-e-salada'),
    ('Frango grelhado com batata-doce e brócolis', 'frango-grelhado-com-batata-doce-e-brocolis'),
    ('Iogurte com banana e linhaça', 'iogurte-com-banana-e-linhaca'),
    ('Iogurte com morango e aveia', 'iogurte-com-morango-e-aveia'),
    ('Lentilha com legumes', 'lentilha-com-legumes'),
    ('Macarrão com frango e brócolis', 'macarrao-com-frango-e-brocolis'),
    ('Maçã assada com mel e aveia', 'maca-assada-com-mel-e-aveia'),
    ('Merluza assada com batata e cenoura', 'merluza-assada-com-batata-e-cenoura'),
    ('Mingau de aveia com banana', 'mingau-de-aveia-com-banana'),
    ('Mix de castanhas', 'mix-de-castanhas'),
    ('Morangos com chocolate meio amargo', 'morangos-com-chocolate-meio-amargo'),
    ('Omelete de forno com espinafre e ricota', 'omelete-de-forno-com-espinafre-e-ricota'),
    ('Omelete de legumes com queijo minas', 'omelete-de-legumes-com-queijo-minas'),
    ('Ovos cozidos com tomate', 'ovos-cozidos-com-tomate'),
    ('Ovos mexidos com couve', 'ovos-mexidos-com-couve'),
    ('Panqueca de banana e aveia', 'panqueca-de-banana-e-aveia'),
    ('Pasta de amendoim caseira', 'pasta-de-amendoim-caseira'),
    ('Patinho grelhado com arroz integral e feijão', 'patinho-grelhado-com-arroz-integral-e-feijao'),
    ('Picolé de manga com iogurte', 'picole-de-manga-com-iogurte'),
    ('Pão integral com ovo mexido e tomate', 'pao-integral-com-ovo-mexido-e-tomate'),
    ('Salada de atum com grão-de-bico', 'salada-de-atum-com-grao-de-bico'),
    ('Salada de frutas', 'salada-de-frutas'),
    ('Salmão grelhado com legumes', 'salmao-grelhado-com-legumes'),
    ('Sanduíche de peru com ricota', 'sanduiche-de-peru-com-ricota'),
    ('Sanduíche natural de frango', 'sanduiche-natural-de-frango'),
    ('Sardinha assada com batata', 'sardinha-assada-com-batata'),
    ('Sopa de legumes com frango', 'sopa-de-legumes-com-frango'),
    ('Sorvete de banana', 'sorvete-de-banana'),
    ('Strogonoff de frango fit', 'strogonoff-de-frango-fit'),
    ('Tapioca com queijo e ovo', 'tapioca-com-queijo-e-ovo'),
    ('Tofu grelhado com legumes', 'tofu-grelhado-com-legumes'),
    ('Vitamina de banana com aveia', 'vitamina-de-banana-com-aveia'),
    ('Abacate, 100 g', 'abacate-100-g'),
    ('Amendoim torrado, 30 g', 'amendoim-torrado-30-g'),
    ('Atum em conserva, 1 lata', 'atum-em-conserva-1-lata'),
    ('Banana prata, 1 unidade', 'banana-prata-1-unidade'),
    ('Batata-doce cozida, 150 g', 'batata-doce-cozida-150-g'),
    ('Café sem açúcar, 1 xícara', 'cafe-sem-acucar-1-xicara'),
    ('Castanha-de-caju, 30 g', 'castanha-de-caju-30-g'),
    ('Castanha-do-Brasil, 2 unidades', 'castanha-do-brasil-2-unidades'),
    ('Chocolate meio amargo, 30 g', 'chocolate-meio-amargo-30-g'),
    ('Iogurte natural desnatado, 1 pote', 'iogurte-natural-desnatado-1-pote'),
    ('Laranja, 1 unidade', 'laranja-1-unidade'),
    ('Linhaça, 1 colher de sopa', 'linhaca-1-colher-de-sopa'),
    ('Mamão papaia, metade', 'mamao-papaia-metade'),
    ('Maçã, 1 unidade', 'maca-1-unidade'),
    ('Mel, 1 colher de sopa', 'mel-1-colher-de-sopa'),
    ('Morangos, 1 xícara', 'morangos-1-xicara'),
    ('Ovo cozido, 1 unidade', 'ovo-cozido-1-unidade'),
    ('Peito de frango grelhado, 100 g', 'peito-de-frango-grelhado-100-g'),
    ('Pão integral, 1 fatia', 'pao-integral-1-fatia'),
    ('Queijo minas frescal, 1 fatia', 'queijo-minas-frescal-1-fatia'),
    ('Ricota, 50 g', 'ricota-50-g'),
    ('Uva, 1 cacho pequeno', 'uva-1-cacho-pequeno'),
    ('Água de coco, 1 copo', 'agua-de-coco-1-copo')
  ) as v(nome, slug)
  where r.familia_id is null and r.nome = v.nome;

-- Bucket privado; cada família só mexe na própria pasta.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('fotos', 'fotos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do nothing;

create policy "familia le suas fotos" on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and public.eh_membro(((storage.foldername(name))[1])::uuid));
create policy "familia envia fotos" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and public.eh_membro(((storage.foldername(name))[1])::uuid));
create policy "familia troca fotos" on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and public.eh_membro(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'fotos' and public.eh_membro(((storage.foldername(name))[1])::uuid));
create policy "familia apaga fotos" on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and public.eh_membro(((storage.foldername(name))[1])::uuid));
