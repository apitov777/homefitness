import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const chave = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

// persistSession guarda a sessão no armazenamento do app instalado: entrou uma vez, abre direto.
export const supabase = createClient(url, chave, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})
