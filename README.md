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

デフォルトでは認証なしで動作し、URL を知っている人は誰でもボードを閲覧・編集できます。パスワードログインと招待制のアカウント管理を有効にするには以下の手順を実行します。**認証を使わない場合、この節の作業は一切不要です。**

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
| 既存ボードの閲覧・編集 | `guest_access` とボードの公開範囲に従う | ボードの公開範囲に従う | ○ |
| ボードの新規作成 | × | ○(クォータ設定時は上限まで) | ○ |
| 自分のボードの削除・共有設定 | × | ○(作成者・オーナー) | ○ |
| 招待リンクの発行 | × | ×(設定で許可可能) | ○ |
| ユーザー管理・全ボード削除・インスタンス設定 | × | × | ○(`/admin`) |

- アカウント作成は招待リンク(`/invite/<token>`)経由のみです
- パスワードリセット機能はありません。忘れた場合は管理者が再招待し、本人が新アカウントを作る運用です(自分のパスワード変更はログイン後に可能)
- BAN されたユーザーのセッションは即時無効になります

### ボードの公開範囲とメンバー(共有設定)

各ボードには公開範囲(visibility)があり、ホーム画面・管理画面の「共有設定」から変更できます。変更できるのはボードの作成者・オーナー役割のメンバー・admin です。

- `link`(リンク共有): URL を知っているログインユーザーが編集できます。未ログインの扱いはインスタンスの `guest_access` に従います
- `tenant`(ログインユーザー): このインスタンスのログインユーザーのみ編集できます。未ログインはアクセス不可
- `restricted`(メンバーのみ): 共有設定で追加したメンバーだけがアクセスできます

メンバーはログインIDで追加し、役割を指定します。役割は公開範囲より優先されます。

- `viewer`(閲覧): 閲覧のみ。描画・編集はサーバー側で拒否されます
- `editor`(編集): 閲覧と編集
- `owner`(オーナー): 編集に加えて、共有設定の変更とボードの削除

新規ボードのデフォルト公開範囲は `guest_access` から決まります: `none` なら `tenant`、`view` / `edit` なら `link` です(認証フェーズ1以前に作られた既存ボードは `link` として扱われます)。

### クォータとメンバー招待(/admin)

管理画面の「クォータ・招待ポリシー」で以下を設定できます。

- **ユーザーあたりボード数上限**: member の新規ボード作成数を制限します(0 = 無制限、デフォルト)。admin には適用されません
- **member にも招待リンクの発行を許可する**(デフォルト off): 有効にすると member のホーム画面に招待リンクの発行欄が表示されます。member が発行する招待は有効期限 30 日以内・利用 10 回以内に制限されます。なお、ユーザーを削除するとそのユーザーが発行した招待リンクも失効します

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

## 悪用対策(Cloudflare 側の設定ガイド)

アプリ層の認証が担うのは「説明責任・クォータ・BAN」までで、大量リクエストによる DoS への対策は Cloudflare 側の機能に任せる設計です。アプリに組み込み済みの対策は次の2つだけです。

- WebSocket メッセージのレート制限(Durable Object 側): 1接続あたり毎秒 60 メッセージ(バースト 180)、ストレージ書き込みを伴う操作(描画確定・消去・ページ追加)はさらに毎秒 10(バースト 60)。通常の描画操作には影響せず、超過分は黙って破棄されます
- ボード数クォータ(前節)

以下は Cloudflare ダッシュボードでの追加設定の推奨例です(いずれもアプリ側の変更は不要)。Workers の `workers.dev` ドメインでは利用できない機能があるため、[カスタムドメイン](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)の利用を推奨します。

### Rate Limiting(ログイン試行などの制限)

[Rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)(無料プランでも1ルール利用可)で、認証系エンドポイントへの試行回数を制限します。推奨例:

- 対象: `(http.request.uri.path in {"/login" "/setup"} and http.request.method eq "POST")` または URI path が `/invite/` で始まる POST
- 条件: 同一 IP から 10 秒間に 5 リクエスト超
- アクション: Block(または Managed Challenge)

これによりパスワードの総当たりと招待トークンの探索を大幅に遅くできます。

### Turnstile / Managed Challenge(bot 対策)

コード変更なしで bot 対策を入れるには、[WAF カスタムルール](https://developers.cloudflare.com/waf/custom-rules/)で認証系パス(`/login`、`/setup`、`/invite/*`)に **Managed Challenge** アクションを適用します(内部的に [Turnstile](https://developers.cloudflare.com/turnstile/) と同じ challenge 基盤が使われます。ページへの widget 埋め込みは不要です)。

- 対象例: `http.request.uri.path eq "/login" and http.request.method eq "POST"`
- アクション: Managed Challenge

より広範に守りたい場合は [Bot Fight Mode](https://developers.cloudflare.com/bots/get-started/free/)(無料)の有効化も検討してください。

### その他

- **WAF マネージドルール**: Free プランでも [Cloudflare Free Managed Ruleset](https://developers.cloudflare.com/waf/managed-rules/) が既定で適用されます
- **アクセス元を組織内に限定したい場合**: 前段に Cloudflare Access(上記 SSO の節)を置けば、認証以前にネットワークレベルで遮断できます

## Commands

```sh
npm run typecheck
npm run deploy
```
