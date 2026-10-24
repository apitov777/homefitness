import { useEffect, useMemo, useState } from 'react'
import { carregarComposicao, erroTexto, fmt, nomeTipo, type Composicao, type Pessoa, type TipoRefeicao } from '../dados'
import { fotoEstatica, urlsDasFotos } from '../fotos'
import { carregarFavoritas, carregarReceitas, ehFavorita, formatarPeso, porcaoDe, receitasParaRefeicao, type Favorita, type Receita } from '../semana'

/**
 * As receitas da semana dessas pessoas (favoritas de cada uma e as da família), prontas para entrar numa refeição
 * com um toque: em Registrar e no editor de refeição do Plano. As que servem para o tipo da refeição vêm primeiro.
 */
export default function FavoritasSemana({ pessoas, tipo, onEscolher }: {
  pessoas: Pessoa[]
  tipo: TipoRefeicao | null
  onEscolher: (r: Receita) => void
}) {
  const [receitas, setReceitas] = useState<Receita[] | null>(null)
  const [favs, setFavs] = useState<Favorita[]>([])
  const [comp, setComp] = useState<Map<string, Composicao>>(new Map())
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const [todas, setTodas] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const ids = pessoas.map((p) => p.id)
  const chave = ids.join(',')

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const [rs, fs] = await Promise.all([carregarReceitas(), carregarFavoritas(ids)])
        const minhas = receitasParaRefeicao(rs, fs, ids, null)
        const [c, u] = await Promise.all([carregarComposicao(minhas.map((r) => r.alimento_id)), urlsDasFotos(minhas.map((r) => r.foto))])
        if (!vivo) return
        setReceitas(rs); setFavs(fs); setComp(c); setUrls(u)
      } catch (e) {
        if (vivo) setErro(erroTexto(e))
      }
    })()
    return () => { vivo = false }
  }, [chave])

  const lista = useMemo(() => (receitas ? receitasParaRefeicao(receitas, favs, ids, tipo) : []), [receitas, favs, chave, tipo])
  const servem = tipo ? lista.filter((r) => r.tipos.includes(tipo)) : lista
  const mostrar = todas || !servem.length ? lista : servem
  const escondidas = lista.length - mostrar.length
  const deQuem = (r: Receita) =>
    r.familia_id ? 'da família' : pessoas.filter((p) => ehFavorita(favs, p.id, r.id)).map((p) => `♥ ${p.nome}`).join(' ')

  if (erro) return <p className="erro">{erro}</p>
  if (!receitas) return null
  return (
    <section className="fav-semana" aria-label="Favoritas da semana">
      <div className="fav-topo">
        <h3>Favoritas da semana</h3>
        <small>{lista.length ? 'Toque para pôr na refeição com a porção de cada um.' : 'Guarde receitas com o ♥ na aba Receitas e elas aparecem aqui.'}</small>
      </div>
      {!!mostrar.length && (
        <ul>
          {mostrar.map((r) => {
            const porcao = porcaoDe(r)
            const kcal = ((comp.get(r.alimento_id)?.energia ?? 0) * porcao) / 100
            const src = fotoEstatica(r.foto) ?? (r.foto ? urls.get(r.foto) : undefined)
            return (
              <li key={r.id}>
                <button type="button" onClick={() => onEscolher(r)} aria-label={`Pôr ${r.nome} na refeição`}>
                  {src ? <img className="fav-thumb" src={src} alt="" /> : <span className="fav-thumb sem-foto" aria-hidden="true">♨</span>}
                  <span className="texto">
                    <strong>{r.nome}</strong>
                    <small>{formatarPeso(porcao)} · {fmt(kcal)} kcal · {deQuem(r)}</small>
                  </span>
                  <span className="mais" aria-hidden="true">＋</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {escondidas > 0 && (
        <button type="button" className="link" onClick={() => setTodas(true)}>
          Ver as outras {escondidas} (não são de {tipo ? nomeTipo(tipo).toLowerCase() : 'agora'})
        </button>
      )}
      {todas && !!servem.length && servem.length < lista.length && (
        <button type="button" className="link" onClick={() => setTodas(false)}>Só as desta refeição</button>
      )}
    </section>
  )
}
