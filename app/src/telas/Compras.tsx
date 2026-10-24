import { useCallback, useEffect, useState } from 'react'
import type { Contexto } from '../App'
import { compartilhar } from '../plataforma'
import { carregarAlimentos, carregarPlanos, descreverDias, erroTexto, fmt, hojeISO, nomeTipo, somarDias, type PlanoRefeicao } from '../dados'
import {
  carregarDias, carregarReceitas, diasEntre, formatarPeso, inicioSemana, montarCompras, refeicoesDoDia, rotuloDia, rotuloSemana,
  type DiaPlano, type LinhaCompra, type Receita,
} from '../semana'
import {
  carregarEscolhas, carregarMarcadas, carregarMedidas, emUnidades, escolherOpcao, itensParaComprar, letraOpcao, marcarCompra, pesoPronto,
  proximaSemana, type Escolhas, type Medida,
} from '../compras'

interface Dados {
  planos: PlanoRefeicao[]
  dias: DiaPlano[]
  receitas: Receita[]
  categoria: Map<string, string | null>
}

export default function Compras({ ctx }: { ctx: Contexto }) {
  const hoje = hojeISO()
  const [semana, setSemana] = useState(proximaSemana(hoje))
  const [quem, setQuem] = useState<Set<string>>(new Set(ctx.pessoas.map((p) => p.id)))
  const [dados, setDados] = useState<Dados | null>(null)
  const [escolhas, setEscolhas] = useState<Escolhas>({})
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const [medidas, setMedidas] = useState<Map<string, Medida[]>>(new Map())
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const ate = somarDias(semana, 6)
  const datas = diasEntre(semana, ate)

  useEffect(() => {
    let vivo = true
    setDados(null)
    setErro(null)
    ;(async () => {
      try {
        const planos = await carregarPlanos(ctx.pessoas.map((p) => p.id))
        const [dias, receitas, alimentos, esc, marc] = await Promise.all([
          carregarDias(planos.map((p) => p.id), semana, ate),
          carregarReceitas(),
          carregarAlimentos(),
          carregarEscolhas(ctx.familiaId, semana),
          carregarMarcadas(ctx.familiaId, semana),
        ])
        if (!vivo) return
        setDados({ planos, dias, receitas, categoria: new Map(alimentos.map((a) => [a.id, a.categoria])) })
        setEscolhas(esc)
        setMarcadas(marc)
      } catch (e) {
        if (vivo) setErro(erroTexto(e))
      }
    })()
    return () => { vivo = false }
  }, [ctx.familiaId, ctx.pessoas, semana, ate])

  // O outro pode estar marcando no mercado ao mesmo tempo: ao voltar para o app, relê o que já foi pego.
  const reler = useCallback(() => {
    if (document.visibilityState === 'visible') carregarMarcadas(ctx.familiaId, semana).then(setMarcadas).catch(() => {})
  }, [ctx.familiaId, semana])
  useEffect(() => {
    document.addEventListener('visibilitychange', reler)
    return () => document.removeEventListener('visibilitychange', reler)
  }, [reler])

  const pessoas = ctx.pessoas.filter((p) => quem.has(p.id))
  const doDia = dados
    ? pessoas.flatMap((p) => datas.flatMap((data) => refeicoesDoDia(dados.planos, dados.dias, p.id, data).map((r) => ({ data, pessoaId: p.id, r }))))
    : []
  const c = dados
    ? montarCompras(doDia.map((x) => ({ data: x.data, pessoaId: x.pessoaId, itens: itensParaComprar(x.r, escolhas) })), dados.receitas, (id) => dados.categoria.get(id) ?? null)
    : null
  const linhas = c ? c.categorias.flatMap(([, ls]) => ls) : []
  const chaveIds = linhas.map((l) => l.id).sort().join()

  useEffect(() => {
    const ids = chaveIds ? chaveIds.split(',') : []
    const faltam = ids.filter((id) => !medidas.has(id))
    if (faltam.length) carregarMedidas(faltam).then((m) => setMedidas((x) => new Map([...x, ...m]))).catch(() => {})
  }, [chaveIds])

  // Refeições com opção B, C… que acontecem na semana e não têm cardápio próprio em todos os dias.
  const comOpcoes = (() => {
    const vistos = new Map<string, { plano: PlanoRefeicao; dias: number }>()
    for (const x of doDia) {
      if (!x.r.plano.plano_opcao.length || x.r.dia) continue
      const v = vistos.get(x.r.plano.id) ?? { plano: x.r.plano, dias: 0 }
      v.dias++
      vistos.set(x.r.plano.id, v)
    }
    return [...vistos.values()]
  })()

  const semDieta = dados ? pessoas.filter((p) => !doDia.some((x) => x.pessoaId === p.id)) : []
  const faltando = linhas.filter((l) => !marcadas.has(l.id))
  const nome = (id: string) => ctx.pessoas.find((p) => p.id === id)?.nome.split(' ')[0] ?? ''

  async function alternar(id: string) {
    const sim = !marcadas.has(id)
    setMarcadas((s) => {
      const n = new Set(s)
      if (sim) n.add(id)
      else n.delete(id)
      return n
    })
    try {
      await marcarCompra(ctx.familiaId, semana, id, sim)
    } catch (e) {
      setErro(erroTexto(e))
      setMarcadas(await carregarMarcadas(ctx.familiaId, semana).catch(() => marcadas))
    }
  }

  async function escolher(planoId: string, opcaoId: string | null) {
    const antes = escolhas
    setEscolhas((e) => {
      const n = { ...e }
      if (opcaoId) n[planoId] = opcaoId
      else delete n[planoId]
      return n
    })
    try {
      await escolherOpcao(ctx.familiaId, semana, planoId, opcaoId)
    } catch (e) {
      setErro(erroTexto(e))
      setEscolhas(antes)
    }
  }

  async function enviar() {
    if (!c) return
    const texto = [
      `Compra da semana · ${rotuloSemana(semana, ate)}`,
      ...c.categorias.flatMap(([cat, ls]) => {
        const resto = ls.filter((l) => !marcadas.has(l.id))
        if (!resto.length) return []
        return ['', cat, ...resto.map((l) => `- ${l.nome}: ${formatarPeso(l.gramas)}${emUnidades(l.gramas, medidas.get(l.id)) ? ` (${emUnidades(l.gramas, medidas.get(l.id))})` : ''}`)]
      }),
    ].join('\n')
    const r = await compartilhar('Compra da semana', texto)
    setMsg(r === 'copiado' ? 'Lista copiada.' : null)
  }

  const proxima = proximaSemana(hoje)
  const qualSemana = semana === proxima ? 'Próxima semana' : semana === inicioSemana(hoje) ? 'Esta semana' : null

  function linha(l: LinhaCompra) {
    const unidades = emUnidades(l.gramas, medidas.get(l.id))
    const partes = Object.entries(l.porPessoa)
    return (
      <li key={l.id} className={marcadas.has(l.id) ? 'item-compra pego' : 'item-compra'}>
        <label>
          <input type="checkbox" checked={marcadas.has(l.id)} onChange={() => alternar(l.id)} />
          <span className="nome">
            {l.nome}
            {(partes.length > 1 || pesoPronto(l.nome)) && (
              <small>
                {partes.length > 1 && partes.map(([p, g]) => `${nome(p)} ${formatarPeso(g)}`).join(' · ')}
                {partes.length > 1 && pesoPronto(l.nome) && ' · '}
                {pesoPronto(l.nome) && 'peso já pronto'}
              </small>
            )}
          </span>
          <span className="quanto">
            {formatarPeso(l.gramas)}
            {unidades && <small>{unidades}</small>}
          </span>
        </label>
      </li>
    )
  }

  return (
    <div className="tela compras">
      <h1>Compra da semana</h1>
      <div className="cabecalho-data">
        <button onClick={() => setSemana(somarDias(semana, -7))} aria-label="Semana anterior">‹</button>
        <strong className="periodo">
          {rotuloSemana(semana, ate)}
          {qualSemana && <small>{qualSemana}</small>}
        </strong>
        <button onClick={() => setSemana(somarDias(semana, 7))} aria-label="Próxima semana">›</button>
      </div>
      {semana !== proxima && <button className="link" onClick={() => setSemana(proxima)}>Ir para a próxima semana</button>}

      {ctx.pessoas.length > 1 && (
        <div className="chips">
          {ctx.pessoas.map((p) => (
            <button
              key={p.id}
              className={quem.has(p.id) ? 'ativa' : ''}
              onClick={() => setQuem((s) => {
                const n = new Set(s)
                if (n.has(p.id)) n.delete(p.id)
                else n.add(p.id)
                return n
              })}
            >
              {quem.has(p.id) ? '✓ ' : ''}{p.nome}
            </button>
          ))}
        </div>
      )}

      {erro && <p className="erro">{erro}</p>}
      {!dados && !erro && <p className="dica">Carregando…</p>}

      {dados && semDieta.length > 0 && (
        <p className="dica aviso-compra">
          {semDieta.map((p) => p.nome).join(' e ')} não {semDieta.length > 1 ? 'têm' : 'tem'} nenhuma refeição no plano nessa semana.
          Marque os dias de uma dieta em Plano › Dietas para entrar na lista.
        </p>
      )}

      {c && linhas.length > 0 && (
        <section className="cartao resumo-compra">
          <div>
            <strong>{faltando.length ? `Faltam ${faltando.length} de ${linhas.length} itens` : 'Tudo comprado'}</strong>
            <small>
              {doDia.length} refeições de {pessoas.map((p) => p.nome.split(' ')[0]).join(' e ')}, {rotuloDia(semana)} a {rotuloDia(ate)}
            </small>
          </div>
          {faltando.length > 0 && <button className="link" onClick={enviar}>Enviar</button>}
        </section>
      )}
      {msg && <p className="ok">{msg}</p>}

      {comOpcoes.length > 0 && (
        <section className="cartao">
          <h2>Que opção vai fazer?</h2>
          <p className="dica">A lista conta a opção A de cada refeição. Se for fazer outra na semana, troque aqui (vale para os dois celulares).</p>
          <ul className="refeicoes">
            {comOpcoes.map(({ plano, dias }) => {
              const atual = escolhas[plano.id] ?? null
              return (
                <li key={plano.id}>
                  <div className="refeicao-topo">
                    <strong>{nomeTipo(plano.tipo)}</strong>
                    {ctx.pessoas.length > 1 && <span className="hora">{nome(plano.pessoa_id)}</span>}
                    <span className="kcal">{dias === 7 ? descreverDias(plano.dias) : `${dias} ${dias === 1 ? 'dia' : 'dias'}`}</span>
                  </div>
                  <div className="chips opcoes">
                    <button className={!atual ? 'ativa' : ''} onClick={() => escolher(plano.id, null)}>A</button>
                    {plano.plano_opcao.map((o) => (
                      <button key={o.id} className={atual === o.id ? 'ativa' : ''} onClick={() => escolher(plano.id, o.id)}>
                        {letraOpcao(o.ordem)}{o.nome ? ` · ${o.nome}` : ''}
                      </button>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {c && (
        <section className="cartao">
          <h2>Lista</h2>
          {!linhas.length && <p className="dica">Nada planejado nessa semana.</p>}
          {c.categorias.map(([cat, ls]) => {
            const resto = ls.filter((l) => !marcadas.has(l.id))
            if (!resto.length) return null
            return (
              <div key={cat} className="categoria-compra">
                <h3>{cat}</h3>
                <ul className="itens">{resto.map(linha)}</ul>
              </div>
            )
          })}
          {linhas.length > faltando.length && (
            <details className="no-carrinho" open={!faltando.length}>
              <summary>Já peguei ou tenho em casa ({linhas.length - faltando.length})</summary>
              <ul className="itens">{linhas.filter((l) => marcadas.has(l.id)).map(linha)}</ul>
            </details>
          )}
          {linhas.length > 0 && (
            <p className="dica">
              Quantidades somadas das dietas do plano para os 7 dias, com as receitas abertas nos ingredientes. O peso é o da
              tabela: o que está cozido ou grelhado aparece com o peso pronto, e cru você compra um pouco diferente.
            </p>
          )}
        </section>
      )}

      {c && c.panelas.length > 0 && (
        <section className="cartao">
          <details>
            <summary><strong>Quanto cozinhar ({c.panelas.length} {c.panelas.length === 1 ? 'receita' : 'receitas'})</strong></summary>
            {c.panelas.map((p) => (
              <div key={p.receita.id} className="panela">
                <div className="refeicao-topo">
                  <strong>{p.receita.nome}</strong>
                  <span className="kcal">{formatarPeso(p.gramas)}</span>
                </div>
                <small className="dica">
                  ≈ {fmt(p.vezes, 1)} {p.vezes > 0 && p.vezes <= 1 ? 'receita' : 'receitas'} (cada uma rende {formatarPeso(p.receita.rendimento_g)}),
                  em {new Set(p.porDia.map((x) => x.data)).size} {new Set(p.porDia.map((x) => x.data)).size === 1 ? 'dia' : 'dias'}:{' '}
                  {[...new Set(p.porDia.map((x) => x.data))].sort().map(rotuloDia).join(', ')}.
                </small>
              </div>
            ))}
          </details>
        </section>
      )}
    </div>
  )
}
