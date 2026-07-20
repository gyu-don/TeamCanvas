// 認証・管理画面まわりの素朴なサーバーレンダリング HTML。
// client.ts のトーン(system-ui, ダークな #1f2937 のバー, 最小限の装飾)に合わせる。
import {
  normalizeVisibility,
  type BoardVisibility,
  type DbBoard,
  type DbBoardMemberWithUser,
  type DbInvite,
  type DbMemberBoard,
  type DbUser,
  type GuestAccess,
} from "./db";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString("ja-JP");
}

const VISIBILITY_LABELS: Record<BoardVisibility, string> = {
  link: "リンク共有",
  tenant: "ログインユーザー",
  restricted: "メンバーのみ",
};

function visibilityBadge(v: string | null): string {
  return `<span class="badge">${VISIBILITY_LABELS[normalizeVisibility(v)]}</span>`;
}

const MEMBER_ROLE_LABELS: Record<string, string> = {
  viewer: "閲覧",
  editor: "編集",
  owner: "オーナー",
};

const STYLE = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #e5e7eb;
    color: #111827;
    min-height: 100vh;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    background: #1f2937;
    color: #f9fafb;
  }
  header .brand { font-weight: 700; }
  header nav { margin-left: auto; display: flex; gap: 14px; }
  header a { color: #d1d5db; text-decoration: none; font-size: 14px; }
  header a:hover { color: #fff; }
  main { max-width: 640px; margin: 32px auto; padding: 0 16px; }
  main.wide { max-width: 900px; }
  h1 { font-size: 20px; margin-bottom: 16px; }
  h2 { font-size: 16px; margin: 28px 0 10px; }
  .card {
    background: #fff;
    border-radius: 8px;
    padding: 20px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.08);
    margin-bottom: 16px;
  }
  label { display: block; font-size: 13px; color: #374151; margin: 12px 0 4px; }
  input[type=text], input[type=password], input[type=email], input[type=number], select {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 14px;
  }
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  button, .btn {
    background: #2563eb;
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 8px 14px;
    font-size: 14px;
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
  }
  button.secondary, .btn.secondary { background: #374151; }
  button.danger, .btn.danger { background: #dc2626; }
  button:disabled { opacity: 0.5; cursor: default; }
  form.inline { display: inline; }
  .error { color: #dc2626; font-size: 13px; margin-top: 10px; }
  .success { color: #16a34a; font-size: 13px; margin-top: 10px; }
  .muted { color: #6b7280; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #e5e7eb; }
  th { color: #6b7280; font-weight: 600; font-size: 12px; text-transform: uppercase; }
  .badge {
    display: inline-block;
    padding: 1px 8px;
    border-radius: 10px;
    font-size: 12px;
    background: #e5e7eb;
    color: #374151;
  }
  .badge.admin { background: #dbeafe; color: #1d4ed8; }
  .badge.banned { background: #fee2e2; color: #b91c1c; }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; }
  code { background: #f3f4f6; padding: 1px 5px; border-radius: 4px; font-size: 13px; }
`;

function layout(opts: {
  title: string;
  body: string;
  wide?: boolean;
  headerUser?: { name: string; role: string } | null;
}): string {
  const { title, body, wide, headerUser } = opts;
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} - TeamCanvas</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <span class="brand">TeamCanvas</span>
  <nav>
    ${
      headerUser
        ? `<span class="muted" style="color:#9ca3af;">${escapeHtml(headerUser.name)}${headerUser.role === "admin" ? ' <span class="badge admin">admin</span>' : ""}</span>
           <a href="/">ホーム</a>
           ${headerUser.role === "admin" ? '<a href="/admin">管理画面</a>' : ""}
           <a href="/me/password">パスワード変更</a>
           <form class="inline" method="post" action="/logout"><button type="submit" class="secondary" style="padding:4px 10px;font-size:13px;">ログアウト</button></form>`
        : ""
    }
  </nav>
</header>
<main${wide ? ' class="wide"' : ""}>
${body}
</main>
</body>
</html>`;
}

/* ---------- /setup ---------- */

export function setupAlreadyDonePage(): string {
  return layout({
    title: "初期設定",
    body: `
      <h1>初期設定は完了しています</h1>
      <div class="card">
        <p>このボードは既にセットアップ済みです。心当たりのないこの表示が出た場合、アカウントが乗っ取られている可能性があります。README の「乗っ取り時の復旧手順」を確認してください。</p>
        <p style="margin-top:12px;"><a href="/login" class="btn">ログインへ</a></p>
      </div>
    `,
  });
}

export function setupFormPage(opts: {
  requireToken: boolean;
  error?: string;
}): string {
  return layout({
    title: "初期設定",
    body: `
      <h1>初期設定(最初の管理者アカウント)</h1>
      <div class="card">
        <form method="post" action="/setup">
          ${
            opts.requireToken
              ? `<label for="token">セットアップトークン</label>
                 <input type="password" id="token" name="token" required autocomplete="off">`
              : ""
          }
          <label for="login_id">ログインID</label>
          <input type="text" id="login_id" name="login_id" required autocomplete="off" maxlength="64" pattern="[0-9A-Za-z._\\-]{1,64}" title="英数と . _ - のみ、64文字以内">
          <label for="name">表示名</label>
          <input type="text" id="name" name="name" required maxlength="64">
          <label for="password">パスワード</label>
          <input type="password" id="password" name="password" required minlength="8" autocomplete="new-password">
          <label for="password2">パスワード(確認)</label>
          <input type="password" id="password2" name="password2" required minlength="8" autocomplete="new-password">
          <div class="row" style="margin-top:16px;">
            <button type="submit">管理者アカウントを作成</button>
          </div>
          ${opts.error ? `<div class="error">${escapeHtml(opts.error)}</div>` : ""}
        </form>
      </div>
    `,
  });
}

/* ---------- /login ---------- */

export function loginPage(opts: { error?: string }): string {
  return layout({
    title: "ログイン",
    body: `
      <h1>ログイン</h1>
      <div class="card">
        <form method="post" action="/login">
          <label for="login_id">ログインID</label>
          <input type="text" id="login_id" name="login_id" required autocomplete="username">
          <label for="password">パスワード</label>
          <input type="password" id="password" name="password" required autocomplete="current-password">
          <div class="row" style="margin-top:16px;">
            <button type="submit">ログイン</button>
          </div>
          ${opts.error ? `<div class="error">${escapeHtml(opts.error)}</div>` : ""}
        </form>
        <p class="muted" style="margin-top:14px;">アカウント作成は管理者からの招待リンクが必要です。パスワードを忘れた場合は管理者に再招待を依頼してください。</p>
      </div>
    `,
  });
}

/* ---------- /invite/:token ---------- */

export function inviteInvalidPage(): string {
  return layout({
    title: "招待リンク",
    body: `
      <h1>この招待リンクは無効です</h1>
      <div class="card">
        <p>有効期限切れ、使用済み、または存在しない招待リンクです。管理者に再発行を依頼してください。</p>
        <p style="margin-top:12px;"><a href="/login" class="btn">ログインへ</a></p>
      </div>
    `,
  });
}

export function invitePage(opts: { token: string; error?: string }): string {
  return layout({
    title: "招待",
    body: `
      <h1>アカウント作成</h1>
      <div class="card">
        <form method="post" action="/invite/${escapeHtml(opts.token)}">
          <label for="login_id">ログインID</label>
          <input type="text" id="login_id" name="login_id" required autocomplete="off" maxlength="64" pattern="[0-9A-Za-z._\\-]{1,64}" title="英数と . _ - のみ、64文字以内">
          <label for="name">表示名</label>
          <input type="text" id="name" name="name" required maxlength="64">
          <label for="password">パスワード</label>
          <input type="password" id="password" name="password" required minlength="8" autocomplete="new-password">
          <label for="password2">パスワード(確認)</label>
          <input type="password" id="password2" name="password2" required minlength="8" autocomplete="new-password">
          <div class="row" style="margin-top:16px;">
            <button type="submit">アカウントを作成</button>
          </div>
          ${opts.error ? `<div class="error">${escapeHtml(opts.error)}</div>` : ""}
        </form>
      </div>
    `,
  });
}

/* ---------- 招待リンクの表(管理画面・ホームで共用) ---------- */

function inviteTable(
  invites: DbInvite[],
  origin: string,
  deleteAction: (token: string) => string,
): string {
  const now = Date.now();
  const rows = invites
    .map((iv) => {
      const url = `${origin}/invite/${iv.token}`;
      const expired = iv.expires_at <= now;
      const usedUp = iv.use_count >= iv.max_uses;
      const status = usedUp ? "使用済み" : expired ? "期限切れ" : "有効";
      return `
        <tr>
          <td><code style="word-break:break-all;">${escapeHtml(url)}</code></td>
          <td class="muted">${escapeHtml(iv.email ?? "")}</td>
          <td class="muted">${iv.use_count}/${iv.max_uses}</td>
          <td class="muted">${fmtDate(iv.expires_at)}</td>
          <td>${status}</td>
          <td>
            <form class="inline" method="post" action="${deleteAction(iv.token)}">
              <button type="submit" class="danger" style="padding:4px 10px;font-size:13px;">失効</button>
            </form>
          </td>
        </tr>`;
    })
    .join("");
  return `<table>
    <tr><th>URL</th><th>メモ</th><th>使用</th><th>有効期限</th><th>状態</th><th></th></tr>
    ${rows}
  </table>`;
}

/* ---------- / (home) ---------- */

export function homePage(opts: {
  user: DbUser;
  boards: DbBoard[];
  memberBoards: DbMemberBoard[];
  invites: DbInvite[];
  canInvite: boolean;
  origin: string;
  error?: string;
}): string {
  const rows = opts.boards
    .map(
      (b) => `
        <tr>
          <td><a href="/b/${escapeHtml(b.id)}">${escapeHtml(b.id)}</a></td>
          <td>${visibilityBadge(b.visibility)}</td>
          <td class="muted">${fmtDate(b.created_at)}</td>
          <td class="muted">${fmtDate(b.last_active)}</td>
          <td class="actions">
            <a class="btn secondary" style="padding:4px 10px;font-size:13px;" href="/b/${encodeURIComponent(b.id)}/settings">共有設定</a>
            <form class="inline" method="post" action="/boards/${encodeURIComponent(b.id)}/delete" onsubmit="return confirm('このボードを削除しますか?元に戻せません。');">
              <button type="submit" class="danger" style="padding:4px 10px;font-size:13px;">削除</button>
            </form>
          </td>
        </tr>`,
    )
    .join("");
  const memberRows = opts.memberBoards
    .map(
      (b) => `
        <tr>
          <td><a href="/b/${escapeHtml(b.id)}">${escapeHtml(b.id)}</a></td>
          <td><span class="badge">${MEMBER_ROLE_LABELS[b.member_role] ?? escapeHtml(b.member_role)}</span></td>
          <td class="muted">${fmtDate(b.last_active)}</td>
          <td>${
            b.member_role === "owner"
              ? `<a class="btn secondary" style="padding:4px 10px;font-size:13px;" href="/b/${encodeURIComponent(b.id)}/settings">共有設定</a>`
              : ""
          }</td>
        </tr>`,
    )
    .join("");
  return layout({
    title: "ホーム",
    headerUser: { name: opts.user.name, role: opts.user.role },
    body: `
      <h1>マイボード</h1>
      ${opts.error ? `<div class="error" style="margin-bottom:12px;">${escapeHtml(opts.error)}</div>` : ""}
      <div class="card">
        <form method="post" action="/boards/new">
          <button type="submit">新規ボードを作成</button>
        </form>
      </div>
      <div class="card">
        ${
          opts.boards.length === 0
            ? '<p class="muted">まだボードがありません。</p>'
            : `<table>
                 <tr><th>ボードID</th><th>公開範囲</th><th>作成日</th><th>最終更新</th><th></th></tr>
                 ${rows}
               </table>`
        }
      </div>
      ${
        opts.memberBoards.length > 0
          ? `<h2>参加中のボード</h2>
             <div class="card">
               <table>
                 <tr><th>ボードID</th><th>役割</th><th>最終更新</th><th></th></tr>
                 ${memberRows}
               </table>
             </div>`
          : ""
      }
      ${
        opts.canInvite
          ? `<h2>招待リンク</h2>
             <div class="card">
               <form method="post" action="/me/invites/new">
                 <div class="row">
                   <div style="flex:1;min-width:160px;">
                     <label for="email">メモ(メールアドレス等・任意)</label>
                     <input type="text" id="email" name="email">
                   </div>
                   <div style="width:140px;">
                     <label for="expires_days">有効期限(日)</label>
                     <input type="number" id="expires_days" name="expires_days" value="7" min="1" max="30">
                   </div>
                   <div style="width:120px;">
                     <label for="max_uses">利用可能回数</label>
                     <input type="number" id="max_uses" name="max_uses" value="1" min="1" max="10">
                   </div>
                 </div>
                 <div class="row" style="margin-top:14px;">
                   <button type="submit">招待リンクを発行</button>
                 </div>
               </form>
             </div>
             <div class="card">
               ${
                 opts.invites.length === 0
                   ? '<p class="muted">発行済みの招待リンクはありません。</p>'
                   : inviteTable(opts.invites, opts.origin, (t) => `/me/invites/${escapeHtml(t)}/delete`)
               }
             </div>`
          : ""
      }
    `,
  });
}

/* ---------- /b/:id 403 ---------- */

export function accessDeniedPage(user: DbUser | null): string {
  return layout({
    title: "アクセス権がありません",
    headerUser: user ? { name: user.name, role: user.role } : null,
    body: `
      <h1>このボードにアクセスする権限がありません</h1>
      <div class="card">
        <p>このボードは「メンバーのみ」に設定されています。ボードのオーナーにメンバー追加を依頼してください。</p>
        <p style="margin-top:12px;"><a href="/" class="btn">ホームへ</a></p>
      </div>
    `,
  });
}

/* ---------- /b/:id/settings ---------- */

export function boardSettingsPage(opts: {
  user: DbUser;
  board: DbBoard;
  members: DbBoardMemberWithUser[];
  creator: DbUser | null;
  error?: string;
  success?: string;
}): string {
  const vis = normalizeVisibility(opts.board.visibility);
  const memberRows = opts.members
    .map(
      (m) => `
        <tr>
          <td>${escapeHtml(m.name)}</td>
          <td class="muted">${escapeHtml(m.login_id)}</td>
          <td>
            <form class="inline row" method="post" action="/b/${encodeURIComponent(opts.board.id)}/settings/members/update" style="gap:6px;">
              <input type="hidden" name="user_id" value="${escapeHtml(m.user_id)}">
              <select name="role" style="width:auto;">
                <option value="viewer" ${m.role === "viewer" ? "selected" : ""}>閲覧</option>
                <option value="editor" ${m.role === "editor" ? "selected" : ""}>編集</option>
                <option value="owner" ${m.role === "owner" ? "selected" : ""}>オーナー</option>
              </select>
              <button type="submit" class="secondary" style="padding:4px 10px;font-size:13px;">変更</button>
            </form>
          </td>
          <td>
            <form class="inline" method="post" action="/b/${encodeURIComponent(opts.board.id)}/settings/members/remove">
              <input type="hidden" name="user_id" value="${escapeHtml(m.user_id)}">
              <button type="submit" class="danger" style="padding:4px 10px;font-size:13px;">削除</button>
            </form>
          </td>
        </tr>`,
    )
    .join("");
  return layout({
    title: `共有設定 - ${opts.board.id}`,
    headerUser: { name: opts.user.name, role: opts.user.role },
    body: `
      <h1>ボード「${escapeHtml(opts.board.id)}」の共有設定</h1>
      <p style="margin-bottom:16px;"><a href="/b/${encodeURIComponent(opts.board.id)}">← ボードへ戻る</a></p>
      ${opts.error ? `<div class="error" style="margin-bottom:12px;">${escapeHtml(opts.error)}</div>` : ""}
      ${opts.success ? `<div class="success" style="margin-bottom:12px;">${escapeHtml(opts.success)}</div>` : ""}

      <h2>公開範囲</h2>
      <div class="card">
        <form method="post" action="/b/${encodeURIComponent(opts.board.id)}/settings/visibility">
          <div class="row">
            <label style="margin:0;"><input type="radio" name="visibility" value="link" ${vis === "link" ? "checked" : ""}> リンク共有(URL を知っているログインユーザーが編集可。未ログインはインスタンスのゲストアクセス設定に従う)</label>
          </div>
          <div class="row">
            <label style="margin:0;"><input type="radio" name="visibility" value="tenant" ${vis === "tenant" ? "checked" : ""}> ログインユーザー(このインスタンスのログインユーザーのみ編集可。未ログインは不可)</label>
          </div>
          <div class="row">
            <label style="margin:0;"><input type="radio" name="visibility" value="restricted" ${vis === "restricted" ? "checked" : ""}> メンバーのみ(下のメンバーに登録した人だけがアクセス可)</label>
          </div>
          <div class="row" style="margin-top:14px;">
            <button type="submit">保存</button>
          </div>
        </form>
      </div>

      <h2>メンバー</h2>
      <div class="card">
        <p class="muted" style="margin-bottom:10px;">
          オーナー: ${opts.creator ? escapeHtml(opts.creator.name) : "(不明)"} / メンバーは公開範囲によらずここで指定した役割でアクセスできます。
        </p>
        <form method="post" action="/b/${encodeURIComponent(opts.board.id)}/settings/members/add">
          <div class="row">
            <div style="flex:1;min-width:160px;">
              <label for="login_id">ログインID</label>
              <input type="text" id="login_id" name="login_id" required autocomplete="off">
            </div>
            <div style="width:140px;">
              <label for="role">役割</label>
              <select id="role" name="role">
                <option value="viewer">閲覧</option>
                <option value="editor" selected>編集</option>
                <option value="owner">オーナー</option>
              </select>
            </div>
          </div>
          <div class="row" style="margin-top:14px;">
            <button type="submit">メンバーを追加</button>
          </div>
        </form>
      </div>
      <div class="card">
        ${
          opts.members.length === 0
            ? '<p class="muted">メンバーはいません。</p>'
            : `<table>
                 <tr><th>表示名</th><th>ログインID</th><th>役割</th><th></th></tr>
                 ${memberRows}
               </table>`
        }
      </div>
    `,
  });
}

/* ---------- /me/password ---------- */

export function passwordChangePage(opts: {
  user: DbUser;
  error?: string;
  success?: boolean;
}): string {
  return layout({
    title: "パスワード変更",
    headerUser: { name: opts.user.name, role: opts.user.role },
    body: `
      <h1>パスワード変更</h1>
      <div class="card">
        <form method="post" action="/me/password">
          <label for="current_password">現在のパスワード</label>
          <input type="password" id="current_password" name="current_password" required autocomplete="current-password">
          <label for="new_password">新しいパスワード</label>
          <input type="password" id="new_password" name="new_password" required minlength="8" autocomplete="new-password">
          <label for="new_password2">新しいパスワード(確認)</label>
          <input type="password" id="new_password2" name="new_password2" required minlength="8" autocomplete="new-password">
          <div class="row" style="margin-top:16px;">
            <button type="submit">変更する</button>
          </div>
          ${opts.error ? `<div class="error">${escapeHtml(opts.error)}</div>` : ""}
          ${opts.success ? `<div class="success">パスワードを変更しました。</div>` : ""}
        </form>
      </div>
    `,
  });
}

/* ---------- /admin ---------- */

export function adminPage(opts: {
  user: DbUser;
  boards: DbBoard[];
  users: DbUser[];
  invites: DbInvite[];
  guestAccess: GuestAccess;
  maxBoardsPerUser: number;
  memberInviteEnabled: boolean;
  origin: string;
  error?: string;
  success?: string;
}): string {
  const boardRows = opts.boards
    .map((b) => {
      const owner = opts.users.find((u) => u.id === b.creator_id);
      return `
        <tr>
          <td><a href="/b/${escapeHtml(b.id)}">${escapeHtml(b.id)}</a></td>
          <td>${owner ? escapeHtml(owner.name) : '<span class="muted">(ゲスト作成 / 不明)</span>'}</td>
          <td>${visibilityBadge(b.visibility)}</td>
          <td class="muted">${fmtDate(b.created_at)}</td>
          <td class="muted">${fmtDate(b.last_active)}</td>
          <td class="actions">
            <a class="btn secondary" style="padding:4px 10px;font-size:13px;" href="/b/${encodeURIComponent(b.id)}/settings">共有設定</a>
            <form class="inline" method="post" action="/admin/boards/${encodeURIComponent(b.id)}/delete" onsubmit="return confirm('このボードを完全に削除しますか?元に戻せません。');">
              <button type="submit" class="danger" style="padding:4px 10px;font-size:13px;">削除</button>
            </form>
          </td>
        </tr>`;
    })
    .join("");

  const userRows = opts.users
    .map((u) => {
      const isSelf = u.id === opts.user.id;
      return `
        <tr>
          <td>${escapeHtml(u.name)}</td>
          <td class="muted">${escapeHtml(u.login_id)}</td>
          <td>${u.role === "admin" ? '<span class="badge admin">admin</span>' : '<span class="badge">member</span>'}</td>
          <td>${u.status === "banned" ? '<span class="badge banned">banned</span>' : '<span class="badge">active</span>'}</td>
          <td class="muted">${fmtDate(u.created_at)}</td>
          <td class="actions">
            ${
              isSelf
                ? '<span class="muted">(自分)</span>'
                : `
              <form class="inline" method="post" action="/admin/users/${escapeHtml(u.id)}/${u.status === "banned" ? "unban" : "ban"}">
                <button type="submit" class="secondary" style="padding:4px 10px;font-size:13px;">${u.status === "banned" ? "解除" : "BAN"}</button>
              </form>
              <form class="inline" method="post" action="/admin/users/${escapeHtml(u.id)}/delete" onsubmit="return confirm('このユーザーを削除しますか?');">
                <button type="submit" class="danger" style="padding:4px 10px;font-size:13px;">削除</button>
              </form>`
            }
          </td>
        </tr>`;
    })
    .join("");

  return layout({
    title: "管理画面",
    wide: true,
    headerUser: { name: opts.user.name, role: opts.user.role },
    body: `
      <h1>管理画面</h1>
      ${opts.error ? `<div class="error">${escapeHtml(opts.error)}</div>` : ""}
      ${opts.success ? `<div class="success">${escapeHtml(opts.success)}</div>` : ""}

      <h2>ゲストアクセス</h2>
      <div class="card">
        <form method="post" action="/admin/settings/guest_access">
          <div class="row">
            <label style="margin:0;"><input type="radio" name="guest_access" value="none" ${opts.guestAccess === "none" ? "checked" : ""}> 不可(未ログインは常にログインへ誘導)</label>
          </div>
          <div class="row">
            <label style="margin:0;"><input type="radio" name="guest_access" value="view" ${opts.guestAccess === "view" ? "checked" : ""}> 閲覧のみ(既存ボードを未ログインで閲覧可)</label>
          </div>
          <div class="row">
            <label style="margin:0;"><input type="radio" name="guest_access" value="edit" ${opts.guestAccess === "edit" ? "checked" : ""}> 編集可(未ログインでも既存ボードを編集可。ボード作成は不可)</label>
          </div>
          <div class="row" style="margin-top:14px;">
            <button type="submit">保存</button>
          </div>
        </form>
      </div>

      <h2>クォータ・招待ポリシー</h2>
      <div class="card">
        <form method="post" action="/admin/settings/policies">
          <div class="row">
            <div style="width:240px;">
              <label for="max_boards_per_user">ユーザーあたりボード数上限(0 = 無制限)</label>
              <input type="number" id="max_boards_per_user" name="max_boards_per_user" value="${opts.maxBoardsPerUser}" min="0" max="10000">
            </div>
          </div>
          <div class="row" style="margin-top:12px;">
            <label style="margin:0;"><input type="checkbox" name="member_invite" value="1" ${opts.memberInviteEnabled ? "checked" : ""}> member にも招待リンクの発行を許可する(ホーム画面に発行欄が表示されます)</label>
          </div>
          <div class="row" style="margin-top:14px;">
            <button type="submit">保存</button>
          </div>
        </form>
        <p class="muted" style="margin-top:10px;">上限は member の新規作成時に適用されます(admin には適用されません)。</p>
      </div>

      <h2>招待リンク</h2>
      <div class="card">
        <form method="post" action="/admin/invites/new">
          <div class="row">
            <div style="flex:1;min-width:160px;">
              <label for="email">メモ(メールアドレス等・任意)</label>
              <input type="text" id="email" name="email">
            </div>
            <div style="width:140px;">
              <label for="expires_days">有効期限(日)</label>
              <input type="number" id="expires_days" name="expires_days" value="7" min="1" max="365">
            </div>
            <div style="width:120px;">
              <label for="max_uses">利用可能回数</label>
              <input type="number" id="max_uses" name="max_uses" value="1" min="1" max="1000">
            </div>
          </div>
          <div class="row" style="margin-top:14px;">
            <button type="submit">招待リンクを発行</button>
          </div>
        </form>
      </div>
      <div class="card">
        ${
          opts.invites.length === 0
            ? '<p class="muted">発行済みの招待リンクはありません。</p>'
            : inviteTable(opts.invites, opts.origin, (t) => `/admin/invites/${escapeHtml(t)}/delete`)
        }
      </div>

      <h2>ユーザー</h2>
      <div class="card">
        ${
          opts.users.length === 0
            ? '<p class="muted">ユーザーがいません。</p>'
            : `<table>
                 <tr><th>表示名</th><th>ログインID</th><th>権限</th><th>状態</th><th>作成日</th><th></th></tr>
                 ${userRows}
               </table>`
        }
      </div>

      <h2>ボード</h2>
      <div class="card">
        ${
          opts.boards.length === 0
            ? '<p class="muted">ボードがありません。</p>'
            : `<table>
                 <tr><th>ボードID</th><th>作成者</th><th>公開範囲</th><th>作成日</th><th>最終更新</th><th></th></tr>
                 ${boardRows}
               </table>`
        }
      </div>
    `,
  });
}
