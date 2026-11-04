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

## Mercado Pago (consulta financeira)

Para consultar pagamentos de sua própria conta vendedora, obtenha o Access Token de **produção** no painel Mercado Pago Developers, na aplicação específica do Mercado Pago. Cadastre-o somente na Vercel como variável **Secret** `MP_ACCESS_TOKEN`, em Production, e publique novo deploy. Não compartilhe nem comite o token. O aplicativo Mercado Livre e o aplicativo Mercado Pago são separados.

No painel use `Conferir Mercado Pago`: consulta em lotes de 10 os IDs de pagamentos já vinculados aos pedidos do Mercado Livre. A API pode não disponibilizar todos os pagamentos com o token informado; nessa situação os valores permanecem pendentes, sem estimativa de repasse. `net_received_amount` pertence ao pagamento e pode diferir do valor líquido de venda devido a frete/ajustes; `money_release_date` é uma data de liberação, não comprovante de saque para conta bancária. Para conciliação definitiva, adicionar os Relatórios de Liberações/Dinheiro em conta do Mercado Pago.
