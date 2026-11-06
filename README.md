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

## Integração Shopee (aguardando Go-Live)

1. No SQL Editor do projeto Supabase conectado à Vercel, execute `supabase/shopee.sql`. Este script só cria tabelas Shopee, sem modificar Mercado Livre.
2. Aguarde a Shopee aprovar a solicitação Go-Live e disponibilizar o **Live Partner ID** e **Live Partner Key** (não use as credenciais de teste no ambiente de produção).
3. Configure em **Vercel → Settings → Environment Variables → Production** as variáveis secretas `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY` e a configuração `SHOPEE_REDIRECT_URI=https://shopee-conciliador-2.vercel.app/api/shopee/callback`. O domínio deve ser aquele cadastrado como Live Redirect URL Domain na Shopee.
4. Faça novo deploy e, no Concilia, clique em **Conectar Shopee**, autorize a loja e depois clique em **Importar 7 dias** e **Conferir valores Shopee**.
5. A consulta usa HMAC-SHA256, nonce em cookie HttpOnly e estado temporário no banco. Os tokens ficam criptografados no Supabase com `TOKEN_ENCRYPTION_KEY` (já usado pelo Mercado Livre). A API não divulga os tokens ao navegador.

**Limitações:** a importação inicial busca até 100 páginas de 50 pedidos em sete dias; o painel mostra 100 registros recentes. A API Payment retorna `escrow_amount` (recebimento esperado) e, quando presente, `escrow_amount_after_adjustment`; valores podem mudar até a conclusão, e não comprovam transferência bancária. Para conciliação de recebidos, será necessário comparar com as liberações/extratos da Shopee. A integração ainda não foi testada com credenciais Live.

## Múltiplas contas e lojas

O painel permite adicionar contas Mercado Livre e lojas Shopee. Em cada aba, a seleção filtra pedidos, totais, tarifas, fretes e consultas financeiras pelo identificador da conta.

Mercado Livre: clique em **+ Adicionar conta** e autorize outro vendedor. Se a plataforma mostrar a conta já cadastrada, mude de usuário no próprio Mercado Livre antes de confirmar a autorização. A conexão existente permanece; seller_id é único.

Shopee: depois da aprovação Go-Live e da configuração das credenciais Live, use **+ Adicionar loja Shopee** para autorizar cada loja. A loja é selecionada pelo shop_id.

Mercado Pago: a versão atual ainda utiliza um único MP_ACCESS_TOKEN, associado à conta emissora. Uma segunda conta pode não ter permissão para consultar pagamentos financeiros. As datas de liberação não provam depósitos.

As tabelas atuais já admitem múltiplas lojas por seller_id/shop_id e pedidos com chaves compostas. Nenhuma migração adicional é necessária para o seletor multiloja. Não exponha os tokens ao navegador.

## Conciliação retroativa por calendário

O usuário pode selecionar data inicial e final na aba Mercado Livre ou Shopee, clicar em **Importar período selecionado** e depois em **Ver relatório do período**. O atalho **Sincronizar 7 dias / Importar 7 dias** continua disponível. Um período longo é dividido automaticamente em janelas de até 7 dias, com paginação e atualização de progresso, até o limite de 366 dias por execução.

A consulta usa **data de criação do pedido em UTC**, incluindo o dia inicial e final. Consultas de frete e pagamentos do Mercado Livre e consultas de escrow da Shopee usam as mesmas datas escolhidas, mas são operações separadas após a importação. Os relatórios exibem no máximo 500 pedidos Mercado Livre e 100 Shopee por tela; contadores refletem pedidos armazenados no período, não garantem toda a cobertura da API. A disponibilidade de pedidos históricos depende das regras e limites vigentes das APIs de cada plataforma.

Em janelas que atinjam o teto de paginação, a consulta **não** informa sucesso: ela mostra uma mensagem de importação parcial e instrui a reduzir a janela. Os dados já importados não são apagados. Reimportações usam as chaves de pedido e loja para evitar duplicatas. Os valores exibidos não comprovam depósito ou repasse: discrepâncias definitivas exigem cruzamento com relatórios de liquidação e extratos.

### Alertas iniciais de conciliação

No Mercado Livre, a coluna **Diferença indicativa** compara `net_after_shipping` e `mp_net` quando os dois existem. Diferença acima de R$ 0,05 pode ser filtrada como caso a investigar, não como valor perdido: ainda pode haver estornos, ajustes ou diferenças de bases de cálculo. O filtro considera somente os pedidos carregados (até 500 por tela). Na Shopee os valores de escrow não são prova de transferência efetiva, e o relatório precisa ser cruzado com a liquidação para uma auditoria definitiva.
