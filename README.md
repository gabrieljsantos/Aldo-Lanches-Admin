# Aldo Lanches Admin

Painel administrativo estático, pronto para GitHub Pages. Usa Supabase Auth (Google), RLS e Realtime.

## Preparação

1. Execute a migração `Smart Store Hub/services/core/migrations/20261004_platform_foundation.sql` no Supabase.
2. Ative o provedor Google no Supabase Auth e cadastre a URL do Pages nos redirects permitidos.
3. Faça login uma vez e inclua manualmente o primeiro UUID em `public.admin_users` pelo SQL Editor.
4. Abra `index.html` por um servidor HTTP local ou publique a pasta no GitHub Pages.

## Chaves e teste local

O arquivo `.env` local contém os lugares para preencher o Client ID e o Client Secret do Google. Ele é ignorado pelo Git e não será publicado. O `.env.example` documenta os mesmos campos sem expor segredos.

Depois de preencher os dados, valide a configuração e a conexão pública com:

```bash
node scripts/check-config.mjs
```

Para copiar com segurança a chave secreta já usada pelo Smart Store Hub, sem exibi-la:

```bash
node scripts/sync-service-key.mjs
```

O sincronizador valida se a chave de origem é realmente aceita como chave secreta antes de gravá-la no `.env` local do Admin. O arquivo permanece ignorado pelo Git. O script tenta restringir suas permissões ao usuário local e avisa quando o sistema de arquivos não oferece esse recurso.

O Client ID e o Client Secret do Google devem ser cadastrados também em **Supabase → Authentication → Providers → Google**. O painel publicado não lê `.env`: o navegador usa apenas `config.js`, que deve conter exclusivamente a URL e a chave `publishable` do Supabase.

`config.js` contém somente URL e chave pública/publishable do Supabase. Nunca adicione `service_role`, senha do banco ou segredo OAuth ao repositório.

## Áreas

- fila de pedidos por estado;
- confirmação humana dos candidatos interpretados pela IA;
- estoque direto e componentes, com saldo absoluto ou registro agregado de vendas;
- visão do catálogo;
- administração das contas autorizadas.
