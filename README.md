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
- `src/auth.ts` — パスワードハッシュ(PBKDF2)とセッション Cookie(HMAC 署名)。認証を有効にした場合のみ使用
- `src/db.ts` — D1 のスキーマ初期化とクエリ。テーブルはランタイムで自動作成(migrations 不要)
- `src/pages.ts` — ログイン・初期設定・招待・ホーム・管理画面のサーバーレンダリング HTML

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

## 認証機能を有効にする(任意)

デフォルトでは認証なしで動作し、URL を知っている人は誰でもボードを閲覧・編集できます(従来通り)。パスワードログインと招待制のアカウント管理を有効にするには以下の手順を実行します。**認証を使わない場合、この節の作業は一切不要です。**

1. D1 データベースを作成する

   ```sh
   npx wrangler d1 create teamcanvas
   ```

2. `wrangler.jsonc` 末尾の `d1_databases` と `vars`(`AUTH_MODE`)のコメントを外し、手順1で表示された `database_id` を記入する
3. デプロイする(テーブルはランタイムで自動作成されるので、migrations の実行は不要)
4. ブラウザで `/setup` を開き、最初の管理者アカウントを作成する

### SETUP_TOKEN(推奨)

デプロイから最初に `/setup` へアクセスするまでの間は、URL を知っている誰でも管理者アカウントを作れてしまいます。CI からデプロイして初回アクセスまで時間が空く場合は、事前にセットアップトークンを設定しておくことを推奨します。

```sh
npx wrangler secret put SETUP_TOKEN
```

設定すると `/setup` にトークンの入力欄が追加され、一致しないとアカウントを作成できません。

### 権限の要約

| 操作 | 未ログイン(ゲスト) | member | admin |
| --- | --- | --- | --- |
| 既存ボードの閲覧・編集 | `guest_access` に従う | ○ | ○ |
| ボードの新規作成 | × | ○ | ○ |
| 自分が作成したボードの削除 | × | ○ | ○ |
| 招待リンクの発行・ユーザー管理・全ボード削除 | × | × | ○(`/admin`) |

- アカウント作成は管理者が発行する招待リンク(`/invite/<token>`)経由のみです
- パスワードリセット機能はありません。忘れた場合は管理者が再招待し、本人が新アカウントを作る運用です(自分のパスワード変更はログイン後に可能)
- BAN されたユーザーのセッションは即時無効になります

### ゲストアクセス(guest_access)

未ログインユーザーの扱いは管理画面 `/admin` で切り替えられます。

- `none`(デフォルト): ボードにアクセス不可。ログインページへ誘導
- `view`: 既存ボードを閲覧のみ可能(描画・編集は不可)
- `edit`: 既存ボードを編集可能(従来の「ゲストN」として参加)。ボードの新規作成は不可

いずれの場合も、ゲストは登録済みのボードにしかアクセスできません(でたらめな URL で新しいボードを作られることはありません)。

### 乗っ取り時・管理者パスワード忘れ時の復旧

`/setup` を開いて「初期設定は完了しています」と表示されるのに心当たりがない場合や、管理者パスワードを忘れた場合は、ユーザーテーブルを消してから `/setup` をやり直します(ボードの中身は消えません)。

```sh
npx wrangler d1 execute teamcanvas --remote --command "DELETE FROM users"
```

その後 `/setup` に再アクセスして管理者アカウントを作り直し、必要なら各ユーザーを再招待してください。

### SSO を使いたい場合

Google Workspace 等の SSO が必要な場合は、Worker の前段に [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) を置くのが簡単です(このアプリ側の変更は不要)。

## Commands

```sh
npm run typecheck
npm run deploy
```
