# TeamCanvas

Cloudflare Workers + Durable Objects で動くページ指向のリアルタイムホワイトボードです(JamBoard 風)。

## 機能

- ページの追加・切り替え(画面下部のタブ)
- ペン(6色・太さ変更)と消しゴム(ストローク単位で削除)
- リアルタイム共同編集(1ボードあたり10人未満を想定)
- 参加者のマーカー(カーソル)位置と名前の表示
- 「URLをコピー」ボタンで共有。同じ URL を開けば同じボードに参加

## アーキテクチャ

- `src/index.ts` — Hono ルーター。`/` は新規ボードへリダイレクト、`/b/:id` がボード画面、`/b/:id/ws` が WebSocket
- `src/room.ts` — `BoardRoom` Durable Object(1ボード = 1インスタンス)。WebSocket Hibernation API で接続を保持し、ストロークを DO ストレージ(SQLite)に永続化
- `src/client.ts` — ボード画面の HTML/JS(Canvas 描画、依存ライブラリなし)

無料枠に収まるよう、Durable Objects は SQLite バックエンド(`new_sqlite_classes`)、WebSocket は Hibernation API を使用し、描画点・カーソルはクライアント側でスロットリングしてメッセージ数を抑えています。

## Local development

```sh
npm install
npm run dev
```

`http://localhost:8787` を開くと新しいボードが作られます。

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
