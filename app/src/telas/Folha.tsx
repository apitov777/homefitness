import type { ReactNode } from 'react'

/** Folha que sobe de baixo, como as do iPhone. Tocar fora fecha. */
export default function Folha({ titulo, onFechar, children }: { titulo: string; onFechar: () => void; children: ReactNode }) {
  return (
    <div className="folha-fundo" onClick={onFechar}>
      <div className="folha" role="dialog" aria-modal="true" aria-label={titulo} onClick={(e) => e.stopPropagation()}>
        <div className="folha-topo">
          <h2>{titulo}</h2>
          <button className="link" onClick={onFechar}>OK</button>
        </div>
        {children}
      </div>
    </div>
  )
}
