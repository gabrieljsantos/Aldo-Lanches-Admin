# Aldo Lanches Admin

Painel administrativo estático, pronto para GitHub Pages. Usa Supabase Auth (Google), RLS e Realtime.

## Preparação

1. Execute a migração `Smart Store Hub/services/core/migrations/20261004_platform_foundation.sql` no Supabase.
2. Ative o provedor Google no Supabase Auth e cadastre a URL do Pages nos redirects permitidos.
3. Faça login uma vez e inclua manualmente o primeiro UUID em `public.admin_users` pelo SQL Editor.
4. Abra `index.html` por um servidor HTTP local ou publique a pasta no GitHub Pages.

`config.js` contém somente URL e chave pública/publishable do Supabase. Nunca adicione `service_role`, senha do banco ou segredo OAuth ao repositório.

## Áreas

- fila de pedidos por estado;
- confirmação humana dos candidatos interpretados pela IA;
- estoque direto e componentes, com saldo absoluto ou registro agregado de vendas;
- visão do catálogo;
- administração das contas autorizadas.
