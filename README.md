# Concilia Marketplaces

Sistema Next.js + Supabase para consultar pedidos Mercado Livre, sem afirmar liberação bancária. Inclui OAuth PKCE, tokens criptografados e painel autenticado por Supabase Auth.

## Configuração

1. No Supabase SQL Editor execute `supabase/mercadolivre.sql`.
2. Na Vercel configure as variáveis de `.env.example`, especialmente `ADMIN_USER_ID` (UUID do administrador), `TOKEN_ENCRYPTION_KEY` (32 bytes hex), `MELI_CLIENT_ID`, `MELI_CLIENT_SECRET`, `MELI_REDIRECT_URI`, `APP_URL` e variáveis do Supabase.
3. Em Mercado Livre Developers cadastre `MELI_REDIRECT_URI` como redirect OAuth, exatamente igual ao domínio principal em produção acrescido de `/api/mercadolivre/callback`.
4. Publique a branch main na Vercel, faça login e clique em Conectar Mercado Livre.
5. Confirme a conexão antes de sincronizar. A primeira importação consulta até 200 pedidos dos últimos sete dias.

## Segurança e limites

As tabelas usam RLS sem permissões públicas. O servidor usa chave service role depois de validar JWT e `ADMIN_USER_ID`. Nunca publique arquivos .env ou secrets. O repositório deve ser privado. Pedidos pagos não significam valores liberados nem depositados. Tarifas de itens não representam todos os descontos.
