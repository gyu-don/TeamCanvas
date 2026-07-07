# TeamCanvas

Cloudflare Workers + Hono + TypeScript の最小アプリです。

## Local development

```sh
npm install
npm run dev
```

`http://localhost:8787` で `Hello TeamCanvas!` を返します。

## Deploy from GitHub

GitHub Actions で `main` ブランチへの push、または手動実行から Cloudflare Workers にデプロイします。

Repository secrets に以下を設定してください。

- `CLOUDFLARE_API_TOKEN`: Cloudflare Workers のデプロイ権限を持つ API token
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID

Hello アプリの時点ではアプリ用 secret は不要です。今後 secret が必要になった場合は、用途に応じて以下を使います。

- GitHub Actions で使う値: GitHub Secrets
- Worker runtime で使う値: `npx wrangler secret put SECRET_NAME`
- 複数環境で一元管理する値: Doppler

## Commands

```sh
npm run typecheck
npm run deploy
```
