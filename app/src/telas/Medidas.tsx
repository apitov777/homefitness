import { emMedidas, fmt, type MedidaCaseira } from '../dados'

/**
 * Medidas caseiras de um alimento ("1 × colher de sopa cheia · 25 g"): um toque põe as gramas.
 * Embaixo, quanto as gramas digitadas dão em medida ("≈ 2 × colher de sopa cheia").
 */
export default function Medidas({ medidas, gramas, onEscolher }: {
  medidas: MedidaCaseira[] | undefined
  gramas: number
  onEscolher: (g: number) => void
}) {
  if (!medidas?.length) return null
  const equivale = emMedidas(medidas, gramas)
  return (
    <div className="medidas">
      {medidas.slice(0, 4).map((m) => (
        <button type="button" key={m.nome} className={Math.abs(m.g - gramas) < 0.5 ? 'ativa' : ''} onClick={() => onEscolher(m.g)}>
          {m.nome} <small>{fmt(m.g)} g</small>
        </button>
      ))}
      {equivale && !medidas.some((m) => Math.abs(m.g - gramas) < 0.5) && <small className="equivale">{equivale}</small>}
    </div>
  )
}
