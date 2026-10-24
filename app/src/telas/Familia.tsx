import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { renderSVG } from 'uqr'
import type { Contexto } from '../App'
import { supabase } from '../supabase'
import { erroTexto, type Pessoa } from '../dados'
import {
  aceitarConvite, cancelarConvite, carregarConvites, carregarMembros, corAvatar, criarConvite, DEPENDENTE,
  formatarCodigo, gerencia, iniciais, linkConvite, meusConvites, mudarPapel, PAPEIS, recusarConvite, removerMembro,
  renovarConvite, sairDaFamilia, textoConvite, transferirOrganizador,
  type Convite, type ConviteRecebido, type Membro, type Papel,
} from '../familia'
import { compartilhar, escolherContato, podeEscolherContato } from '../plataforma'
import CartaoInstalar from './Instalar'
import Folha from './Folha'

type Painel =
  | { tipo: 'membro'; pessoaId: string }
  | { tipo: 'adicionar' }
  | { tipo: 'convite'; convite: Convite }
  | null

const ORDEM: Record<Papel, number> = { organizador: 0, responsavel: 1, adulto: 2, crianca: 3 }

export function Avatar({ id, nome, grande = false }: { id: string; nome: string; grande?: boolean }) {
  return (
    <span className={grande ? 'avatar grande' : 'avatar'} style={{ background: corAvatar(id) }} aria-hidden>
      {iniciais(nome)}
    </span>
  )
}

function vale(c: Convite): string {
  return new Date(c.expira_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function ConvitePronto({ convite, familia, de }: { convite: Convite; familia: string; de: string | undefined }) {
  const [msg, setMsg] = useState<string | null>(null)
  const url = linkConvite(convite.codigo)
  const qr = useMemo(() => renderSVG(url, { border: 2 }), [url])

  async function enviar() {
    setMsg(null)
    try {
      const r = await compartilhar(`Convite para ${familia}`, textoConvite(familia, de, convite.codigo), url)
      if (r === 'copiado') setMsg('Convite copiado. Cole no iMessage, WhatsApp ou e-mail.')
      if (r === 'enviado') setMsg('Convite enviado.')
    } catch (e) {
      setMsg(erroTexto(e))
    }
  }

  async function copiar() {
    await navigator.clipboard.writeText(url)
    setMsg('Link copiado.')
  }

  const quem = convite.nome || convite.email || 'a pessoa'
  return (
    <div className="convite-pronto">
      <p>
        Mande para <strong>{quem}</strong> pelo iMessage, WhatsApp ou e-mail. Vale até {vale(convite)}
        {convite.email ? `, só para ${convite.email}` : ''}.
      </p>
      <button className="primario" onClick={enviar}>Enviar convite</button>
      <div className="codigo-convite" aria-label="Código do convite">{formatarCodigo(convite.codigo)}</div>
      <p className="dica centro">Código para digitar no app, em “Tenho um convite”.</p>
      <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} />
      <p className="dica centro">Convidar pessoalmente: aponte a câmera do outro celular para o QR.</p>
      <button className="link" onClick={copiar}>Copiar link</button>
      {msg && <p className="ok">{msg}</p>}
    </div>
  )
}

function Adicionar({ ctx, meuPapel, onConvite, onFechar }: {
  ctx: Contexto
  meuPapel: Papel | undefined
  onConvite: (c: Convite) => void
  onFechar: () => void
}) {
  const [passo, setPasso] = useState<'escolha' | 'convidar' | 'dependente'>('escolha')
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [papel, setPapel] = useState<Convite['papel']>('adulto')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function daAgenda() {
    try {
      const c = await escolherContato()
      if (c) {
        setNome(c.nome)
        setEmail(c.email)
      }
    } catch (e) {
      setErro(erroTexto(e))
    }
  }

  async function convidar(ev: FormEvent) {
    ev.preventDefault()
    setErro(null)
    setEnviando(true)
    try {
      onConvite(await criarConvite({ familiaId: ctx.familiaId, nome, email, papel }))
    } catch (e) {
      setErro(erroTexto(e))
    } finally {
      setEnviando(false)
    }
  }

  async function adicionarDependente(ev: FormEvent) {
    ev.preventDefault()
    setErro(null)
    const { data, error } = await supabase.from('pessoa').insert({ familia_id: ctx.familiaId, nome: nome.trim() }).select('id').single()
    if (error) return setErro(erroTexto(error))
    await ctx.recarregarPessoas()
    onFechar()
    ctx.abrirCadastro(data.id)
  }

  if (passo === 'escolha')
    return (
      <fieldset className="opcoes">
        <button onClick={() => setPasso('convidar')}>
          <strong>Convidar pessoa</strong>
          <small>Ela entra com o próprio login, no iPhone ou no Android, e ganha o espaço dela: meta, plano e avisos.</small>
        </button>
        <button onClick={() => setPasso('dependente')}>
          <strong>Adicionar criança ou dependente</strong>
          <small>Sem login: a família registra as refeições por ela. Depois dá para dar login.</small>
        </button>
      </fieldset>
    )

  if (passo === 'dependente')
    return (
      <form onSubmit={adicionarDependente}>
        <label>Nome<input required value={nome} onChange={(e) => setNome(e.target.value)} /></label>
        {erro && <p className="erro">{erro}</p>}
        <button className="primario">Adicionar e fazer o cadastro</button>
      </form>
    )

  const papeis: Convite['papel'][] = meuPapel === 'organizador' ? ['adulto', 'responsavel', 'crianca'] : ['adulto', 'crianca']
  return (
    <form onSubmit={convidar}>
      {podeEscolherContato() && (
        <button type="button" onClick={daAgenda}>Escolher dos contatos</button>
      )}
      <label>Nome<input placeholder="opcional" value={nome} onChange={(e) => setNome(e.target.value)} /></label>
      <label>
        E-mail
        <input type="email" placeholder="opcional" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <p className="dica">Com e-mail, só essa conta aceita, e ela entra direto ao criar a conta. Sem e-mail, vale para quem receber o link.</p>
      <fieldset className="opcoes">
        <legend>Papel na família</legend>
        {papeis.map((p) => (
          <button type="button" key={p} className={papel === p ? 'ativa' : ''} onClick={() => setPapel(p)}>
            <strong>{PAPEIS[p].nome}</strong>
            <small>{PAPEIS[p].descricao}</small>
          </button>
        ))}
      </fieldset>
      {erro && <p className="erro">{erro}</p>}
      <button className="primario" disabled={enviando}>Criar convite</button>
    </form>
  )
}

function DetalheMembro({ ctx, p, m, membros, meuPapel, recarregar, onConvite, onFechar }: {
  ctx: Contexto
  p: Pessoa
  m: Membro | undefined
  membros: Membro[]
  meuPapel: Papel | undefined
  recarregar: () => Promise<void>
  onConvite: (c: Convite) => void
  onFechar: () => void
}) {
  const [erro, setErro] = useState<string | null>(null)
  const [papelLogin, setPapelLogin] = useState<Convite['papel']>('adulto')
  const souEu = p.user_id === ctx.session.user.id
  const souOrganizador = meuPapel === 'organizador'
  const outroLogin = !!m && !souEu

  async function rodar(f: () => Promise<void>, depois: () => Promise<void> = recarregar) {
    setErro(null)
    try {
      await f()
      await depois()
    } catch (e) {
      setErro(erroTexto(e))
    }
  }

  async function alternarExames(v: boolean) {
    await rodar(async () => {
      const { error } = await supabase.from('pessoa').update({ compartilha_exames: v }).eq('id', p.id)
      if (error) throw error
    }, ctx.recarregarPessoas)
  }

  function remover() {
    if (!m || !confirm(`${p.nome} sai da família levando os próprios dados (refeições, metas, plano e exames) para uma família própria. Continuar?`)) return
    rodar(() => removerMembro(m.user_id), async () => { await recarregar(); await ctx.recarregarPessoas(); onFechar() })
  }

  function sair() {
    if (!confirm('Você sai da família levando seus dados (refeições, metas, plano e exames) para uma família só sua. Continuar?')) return
    rodar(sairDaFamilia, async () => { onFechar(); await ctx.recarregarFamilia() })
  }

  function passarOrganizador() {
    if (!m || !confirm(`${p.nome} passa a ser o organizador da família, e você fica como responsável. Continuar?`)) return
    rodar(() => transferirOrganizador(m.user_id))
  }

  function apagarDependente() {
    if (!confirm(`Apagar o perfil de ${p.nome}, com todas as refeições, metas, plano e exames? Não dá para desfazer.`)) return
    rodar(async () => {
      const { error } = await supabase.from('pessoa').delete().eq('id', p.id)
      if (error) throw error
    }, async () => { await ctx.recarregarPessoas(); onFechar() })
  }

  function darLogin() {
    rodar(async () => onConvite(await criarConvite({ familiaId: ctx.familiaId, nome: p.nome, papel: papelLogin, pessoaId: p.id })), async () => {})
  }

  const outrosLogins = membros.filter((x) => x.user_id !== ctx.session.user.id).length
  return (
    <div className="detalhe-membro">
      <div className="detalhe-topo">
        <Avatar id={p.id} nome={p.nome} grande />
        <strong>{p.nome}{souEu ? ' (você)' : ''}</strong>
        <span className="dica">{m ? `${PAPEIS[m.papel].nome} · ${m.email}` : `${DEPENDENTE.nome} · sem login`}</span>
        {m && <span className="dica">Na família desde {new Date(m.desde).toLocaleDateString('pt-BR')}</span>}
      </div>

      <ul className="lista-ajustes">
        <li>
          <span>Exames</span>
          {souEu ? (
            <label className="check">
              <input type="checkbox" checked={p.compartilha_exames} onChange={(e) => alternarExames(e.target.checked)} />
              Compartilhar com a família
            </label>
          ) : (
            <small>{!p.user_id ? 'A família vê' : p.compartilha_exames ? 'Compartilhados com a família' : `Só ${p.nome} vê`}</small>
          )}
        </li>
        <li>
          <span>Refeições, plano e metas</span>
          <small>A família vê</small>
        </li>
        {outroLogin && souOrganizador && m.papel !== 'organizador' && (
          <li>
            <span>Papel</span>
            <select
              aria-label={`Papel de ${p.nome}`}
              value={m.papel}
              onChange={(e) => rodar(() => mudarPapel(m.user_id, e.target.value as Papel))}
            >
              <option value="responsavel">Responsável</option>
              <option value="adulto">Adulto</option>
              <option value="crianca">Criança</option>
            </select>
          </li>
        )}
      </ul>
      {m && <p className="dica">{PAPEIS[m.papel].descricao}</p>}
      {!m && <p className="dica">{DEPENDENTE.descricao}</p>}

      <div className="acoes-coluna">
        <button onClick={() => { onFechar(); ctx.abrirCadastro(p.id) }}>Cadastro guiado de {souEu ? 'você' : p.nome}</button>
        {!m && gerencia(meuPapel) && (
          <>
            <div className="linha alinhada">
              <select aria-label="Papel ao entrar" value={papelLogin} onChange={(e) => setPapelLogin(e.target.value as Convite['papel'])}>
                <option value="adulto">Entra como adulto</option>
                <option value="crianca">Entra como criança</option>
              </select>
              <button onClick={darLogin}>Dar login</button>
            </div>
            <button className="link perigo" onClick={apagarDependente}>Apagar o perfil de {p.nome}</button>
          </>
        )}
        {outroLogin && souOrganizador && m.papel !== 'crianca' && (
          <button onClick={passarOrganizador}>Tornar organizador</button>
        )}
        {outroLogin && souOrganizador && <button className="link perigo" onClick={remover}>Remover da família</button>}
        {souEu && outrosLogins > 0 && meuPapel !== 'organizador' && (
          <button className="link perigo" onClick={sair}>Sair da família</button>
        )}
        {souEu && outrosLogins > 0 && meuPapel === 'organizador' && (
          <p className="dica">Para sair, primeiro passe o papel de organizador para outro adulto.</p>
        )}
      </div>
      {erro && <p className="erro">{erro}</p>}
    </div>
  )
}

function ConvitesRecebidos({ ctx, lista, recarregar }: { ctx: Contexto; lista: ConviteRecebido[]; recarregar: () => Promise<void> }) {
  const [erro, setErro] = useState<string | null>(null)
  if (!lista.length) return null

  async function aceitar(c: ConviteRecebido) {
    const sozinho = ctx.pessoas.filter((p) => p.user_id).length === 1
    const aviso = sozinho
      ? `Você entra na família “${c.familia}” e traz tudo desta família junto (dependentes, alimentos e refeições). Continuar?`
      : `Você sai desta família levando seus dados (refeições, metas, plano e exames) e entra em “${c.familia}”. Continuar?`
    if (!confirm(aviso)) return
    setErro(null)
    try {
      await aceitarConvite(c.codigo)
      await ctx.recarregarFamilia()
    } catch (e) {
      setErro(erroTexto(e))
    }
  }

  async function recusar(c: ConviteRecebido) {
    try {
      await recusarConvite(c.codigo)
      await recarregar()
    } catch (e) {
      setErro(erroTexto(e))
    }
  }

  return (
    <section className="cartao destaque-convite">
      <h2>Convites para você</h2>
      {lista.map((c) => (
        <div key={c.codigo} className="recebido">
          <p>{c.convidado_por ?? 'Alguém'} convidou você para a família <strong>{c.familia}</strong>, como {PAPEIS[c.papel].nome.toLowerCase()}.</p>
          <div className="acoes">
            <button className="fiz" onClick={() => aceitar(c)}>Aceitar</button>
            <button onClick={() => recusar(c)}>Recusar</button>
          </div>
        </div>
      ))}
      {erro && <p className="erro">{erro}</p>}
    </section>
  )
}

export default function Familia({ ctx, onVoltar }: { ctx: Contexto; onVoltar: () => void }) {
  const [nomeFamilia, setNomeFamilia] = useState('')
  const [editandoNome, setEditandoNome] = useState(false)
  const [membros, setMembros] = useState<Membro[]>([])
  const [convites, setConvites] = useState<Convite[]>([])
  const [recebidos, setRecebidos] = useState<ConviteRecebido[]>([])
  const [painel, setPainel] = useState<Painel>(null)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    try {
      const [f, m, c, r] = await Promise.all([
        supabase.from('familia').select('nome').eq('id', ctx.familiaId).single(),
        carregarMembros(),
        carregarConvites(ctx.familiaId),
        meusConvites(),
      ])
      if (f.error) throw f.error
      setNomeFamilia(f.data.nome)
      setMembros(m)
      setConvites(c)
      setRecebidos(r)
    } catch (e) {
      setErro(erroTexto(e))
    }
  }, [ctx.familiaId])

  useEffect(() => { carregar() }, [carregar])

  const meuPapel = membros.find((m) => m.user_id === ctx.session.user.id)?.papel
  const membroDe = (p: Pessoa) => membros.find((m) => m.user_id === p.user_id)
  const pessoas = [...ctx.pessoas].sort((a, b) => {
    const pa = membroDe(a)?.papel
    const pb = membroDe(b)?.papel
    return (pa ? ORDEM[pa] : 9) - (pb ? ORDEM[pb] : 9)
  })
  const deNome = ctx.eu?.nome
  const comExames = ctx.pessoas.filter((p) => p.user_id && p.compartilha_exames).map((p) => p.nome)
  const semExames = ctx.pessoas.filter((p) => p.user_id && !p.compartilha_exames).map((p) => p.nome)

  async function salvarNome(ev: FormEvent) {
    ev.preventDefault()
    const { error } = await supabase.from('familia').update({ nome: nomeFamilia.trim() }).eq('id', ctx.familiaId)
    if (error) return setErro(erroTexto(error))
    setEditandoNome(false)
  }

  async function reenviar(c: Convite) {
    try {
      await renovarConvite(c.id)
      const atual = (await carregarConvites(ctx.familiaId)).find((x) => x.id === c.id) ?? c
      setPainel({ tipo: 'convite', convite: atual })
      await carregar()
    } catch (e) {
      setErro(erroTexto(e))
    }
  }

  async function cancelar(c: Convite) {
    if (!confirm(`Cancelar o convite ${c.nome || c.email ? `para ${c.nome || c.email}` : 'por link'}? O link e o código deixam de valer.`)) return
    try {
      await cancelarConvite(c.id)
      await carregar()
    } catch (e) {
      setErro(erroTexto(e))
    }
  }

  const pessoaPainel = painel?.tipo === 'membro' ? ctx.pessoas.find((p) => p.id === painel.pessoaId) : undefined

  return (
    <div className="tela familia">
      <button className="link voltar" onClick={onVoltar}>‹ Perfil</button>
      <div className="familia-topo">
        <div className="avatares" aria-hidden>
          {pessoas.slice(0, 5).map((p) => <Avatar key={p.id} id={p.id} nome={p.nome} />)}
        </div>
        {editandoNome ? (
          <form className="linha alinhada" onSubmit={salvarNome}>
            <input aria-label="Nome da família" required value={nomeFamilia} onChange={(e) => setNomeFamilia(e.target.value)} />
            <button>Salvar</button>
          </form>
        ) : (
          <h1>{nomeFamilia || 'Família'}</h1>
        )}
        <p className="dica">
          {ctx.pessoas.length} {ctx.pessoas.length === 1 ? 'pessoa' : 'pessoas'} · cada uma com a própria meta, plano e avisos
          {meuPapel === 'organizador' && !editandoNome && (
            <> · <button className="link inline" onClick={() => setEditandoNome(true)}>mudar o nome</button></>
          )}
        </p>
      </div>

      <ConvitesRecebidos ctx={ctx} lista={recebidos} recarregar={carregar} />

      <section className="cartao">
        <h2>Membros</h2>
        <ul className="membros">
          {pessoas.map((p) => {
            const m = membroDe(p)
            return (
              <li key={p.id}>
                <button className="membro" onClick={() => setPainel({ tipo: 'membro', pessoaId: p.id })}>
                  <Avatar id={p.id} nome={p.nome} />
                  <span className="membro-texto">
                    <strong>{p.nome}{p.user_id === ctx.session.user.id ? ' (você)' : ''}</strong>
                    <small>{m ? m.email : 'Sem login'}</small>
                  </span>
                  <span className="membro-papel">{m ? PAPEIS[m.papel].nome : DEPENDENTE.nome}</span>
                  <span className="seta" aria-hidden>›</span>
                </button>
              </li>
            )
          })}
        </ul>
        {gerencia(meuPapel) && (
          <button className="primario" onClick={() => setPainel({ tipo: 'adicionar' })}>Adicionar membro</button>
        )}
        {meuPapel && !gerencia(meuPapel) && (
          <p className="dica">Só o organizador e os responsáveis adicionam pessoas.</p>
        )}
      </section>

      {convites.length > 0 && (
        <section className="cartao">
          <h2>Convites enviados</h2>
          <ul className="membros">
            {convites.map((c) => (
              <li key={c.id} className="convite-enviado">
                <span className="membro-texto">
                  <strong>{c.nome || c.email || 'Convite por link'}</strong>
                  <small>
                    {PAPEIS[c.papel].nome} · vale até {vale(c)}{c.email && c.nome ? ` · ${c.email}` : ''}
                  </small>
                </span>
                {gerencia(meuPapel) && (
                  <span className="acoes">
                    <button onClick={() => reenviar(c)}>Enviar de novo</button>
                    <button className="link perigo" onClick={() => cancelar(c)}>Cancelar</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="cartao">
        <h2>O que a família compartilha</h2>
        <ul className="compartilha">
          <li><strong>Refeições, plano e metas</strong><span>Todos veem e podem registrar uns pelos outros. A refeição feita junto é lançada uma vez, com as gramas de cada um.</span></li>
          <li>
            <strong>Exames</strong>
            <span>
              Cada um escolhe.
              {comExames.length > 0 && ` Compartilham: ${comExames.join(', ')}.`}
              {semExames.length > 0 && ` Só a própria pessoa vê: ${semExames.join(', ')}.`}
            </span>
          </li>
          <li><strong>Alimentos pelo rótulo</strong><span>Cadastrados uma vez, valem para todos.</span></li>
          <li><strong>Avisos no celular</strong><span>Cada um liga no próprio aparelho, na aba Plano.</span></li>
        </ul>
        <details>
          <summary>Sobre os papéis</summary>
          <ul className="compartilha">
            {(Object.keys(PAPEIS) as Papel[]).map((k) => <li key={k}><strong>{PAPEIS[k].nome}</strong><span>{PAPEIS[k].descricao}</span></li>)}
            <li><strong>{DEPENDENTE.nome}</strong><span>{DEPENDENTE.descricao}</span></li>
          </ul>
        </details>
      </section>

      <CartaoInstalar />
      {erro && <p className="erro">{erro}</p>}

      {painel?.tipo === 'adicionar' && (
        <Folha titulo="Adicionar membro" onFechar={() => setPainel(null)}>
          <Adicionar
            ctx={ctx}
            meuPapel={meuPapel}
            onConvite={(c) => { setPainel({ tipo: 'convite', convite: c }); carregar() }}
            onFechar={() => setPainel(null)}
          />
        </Folha>
      )}
      {painel?.tipo === 'convite' && (
        <Folha titulo="Convite pronto" onFechar={() => setPainel(null)}>
          <ConvitePronto convite={painel.convite} familia={nomeFamilia} de={deNome} />
        </Folha>
      )}
      {pessoaPainel && (
        <Folha titulo={pessoaPainel.nome} onFechar={() => setPainel(null)}>
          <DetalheMembro
            ctx={ctx}
            p={pessoaPainel}
            m={membroDe(pessoaPainel)}
            membros={membros}
            meuPapel={meuPapel}
            recarregar={carregar}
            onConvite={(c) => { setPainel({ tipo: 'convite', convite: c }); carregar() }}
            onFechar={() => setPainel(null)}
          />
        </Folha>
      )}
    </div>
  )
}
