// Avisos do plano de refeições por Web Push.
// - {acao: "chave"}: devolve a chave pública VAPID (gera o par no primeiro uso).
// - {acao: "teste"}: manda um aviso de teste para os aparelhos do usuário logado.
// - {acao: "rodar"}: chamado pelo pg_cron a cada minuto, com o token de push_config.
import { createClient } from 'npm:@supabase/supabase-js@2'
import * as webpush from 'jsr:@negrel/webpush@0.5.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const CHAVE_SERVICO =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default
// Contato exigido pelo VAPID (RFC 8292); um https evita expor e-mail pessoal.
const CONTATO = Deno.env.get('VAPID_CONTATO') ?? 'https://apitov777.github.io/homefitness/'

const db = createClient(SUPABASE_URL, CHAVE_SERVICO, { auth: { persistSession: false } })

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

interface Config { vapid_publica: string | null; vapid_jwk: webpush.ExportedVapidKeys | null; token_cron: string }

async function lerConfig(): Promise<Config> {
  const { data, error } = await db.from('push_config').select('vapid_publica, vapid_jwk, token_cron').eq('id', 1).single()
  if (error) throw error
  return data as Config
}

let servidor: webpush.ApplicationServer | null = null

async function chaves(): Promise<{ publica: string; servidor: webpush.ApplicationServer }> {
  let cfg = await lerConfig()
  if (!cfg.vapid_jwk) {
    const par = await webpush.generateVapidKeys({ extractable: true })
    const jwk = await webpush.exportVapidKeys(par)
    const publica = await webpush.exportApplicationServerKey(par)
    // Se duas chamadas gerarem ao mesmo tempo, vale a que gravar primeiro.
    await db.from('push_config').update({ vapid_jwk: jwk, vapid_publica: publica }).eq('id', 1).is('vapid_jwk', null)
    cfg = await lerConfig()
  }
  if (!servidor) {
    servidor = await webpush.ApplicationServer.new({
      contactInformation: CONTATO,
      vapidKeys: await webpush.importVapidKeys(cfg.vapid_jwk!),
    })
  }
  return { publica: cfg.vapid_publica!, servidor }
}

interface Inscricao { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }
interface Aviso { chave: string; user_id: string; titulo: string; corpo: string }

async function enviar(avisos: Aviso[]) {
  if (!avisos.length) return { enviados: 0, removidos: 0, falhas: 0 }
  const { servidor } = await chaves()
  const { data, error } = await db
    .from('push_inscricao')
    .select('id, user_id, endpoint, p256dh, auth')
    .in('user_id', [...new Set(avisos.map((a) => a.user_id))])
  if (error) throw error
  const inscricoes = data as Inscricao[]
  let enviados = 0
  let falhas = 0
  const mortas = new Set<string>()
  await Promise.all(
    avisos.flatMap((a) =>
      inscricoes.filter((i) => i.user_id === a.user_id).map(async (i) => {
        try {
          await servidor
            .subscribe({ endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } })
            .pushTextMessage(JSON.stringify({ titulo: a.titulo, corpo: a.corpo, tag: a.chave }), {
              urgency: webpush.Urgency.High,
              ttl: 3600,
            })
          enviados++
        } catch (e) {
          falhas++
          if (e instanceof webpush.PushMessageError) {
            const status = e.response.status
            // 404/410: o aparelho desativou os avisos ou desinstalou o app.
            if (status === 404 || status === 410) mortas.add(i.id)
            console.error('push falhou', status, await e.response.text().catch(() => ''))
          } else {
            console.error('push falhou', e)
          }
        }
      })
    ),
  )
  if (mortas.size) await db.from('push_inscricao').delete().in('id', [...mortas])
  return { enviados, removidos: mortas.size, falhas }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const { acao } = await req.json().catch(() => ({ acao: null }))

    if (acao === 'chave') return resposta({ chave: (await chaves()).publica })

    if (acao === 'teste') {
      const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
      const { data, error } = await db.auth.getUser(jwt)
      if (error || !data.user) return resposta({ erro: 'entre no app primeiro' }, 401)
      const r = await enviar([{
        chave: 'teste:' + Date.now(),
        user_id: data.user.id,
        titulo: 'Avisos ligados ✅',
        corpo: 'É assim que o app vai lembrar das refeições do plano.',
      }])
      return resposta(r)
    }

    if (acao === 'rodar') {
      const cfg = await lerConfig()
      if (req.headers.get('x-avisos-token') !== cfg.token_cron) return resposta({ erro: 'sem permissão' }, 403)
      const { data, error } = await db.rpc('avisos_devidos')
      if (error) throw error
      const r = await enviar(data as Aviso[])
      if ((data as Aviso[]).length) console.log('avisos', (data as Aviso[]).length, JSON.stringify(r))
      return resposta(r)
    }

    return resposta({ erro: 'ação desconhecida' }, 400)
  } catch (e) {
    console.error(e)
    return resposta({ erro: e instanceof Error ? e.message : String(e) }, 500)
  }
})
