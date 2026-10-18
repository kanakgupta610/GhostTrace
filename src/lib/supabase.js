import { createClient } from '@supabase/supabase-js'

// Browser client. Uses the publishable key only; reads are limited by the RLS policies on
// each table. Never put a secret / service-role key in a VITE_ variable: Vite ships those
// to the browser.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey)

// null when the env vars are missing, so the app falls back to the bundled sample cases
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null
