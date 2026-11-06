export function GET(){return Response.json({supabaseUrl:process.env.NEXT_PUBLIC_SUPABASE_URL,publicKey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY},{headers:{'Cache-Control':'no-store'}})}
