import { Hono, type Context } from "hono";
import { boardHtml } from "./client";
import {
  createSessionToken,
  getCurrentUser,
  hashPassword,
  verifyPassword,
  setSessionCookie,
  clearSessionCookie,
} from "./auth";
import {
  countUsers,
  createBoard,
  createInvite,
  createUser,
  deleteBoardRow,
  deleteInvite,
  deleteUser,
  ensureSchema,
  getBoard,
  getGuestAccess,
  getInvite,
  getSessionSecret,
  getUserByLoginId,
  isInviteValid,
  listAllBoards,
  listBoardsByCreator,
  listInvites,
  listUsers,
  setSetting,
  setUserStatus,
  touchBoard,
  tryConsumeInvite,
  updateUserPassword,
  type DbUser,
} from "./db";
import {
  adminPage,
  homePage,
  inviteInvalidPage,
  invitePage,
  loginPage,
  passwordChangePage,
  setupAlreadyDonePage,
  setupFormPage,
} from "./pages";

type Bindings = {
  BOARD: DurableObjectNamespace;
  // 以下2つは wrangler.jsonc でコメントアウトされたデフォルト構成では未設定。
  // 両方揃って初めて認証(モード1)が有効になる。片方だけでは新規ルートは
  // すべて 404 を返し、モード0(認証なし)の挙動を完全に維持する。
  DB?: D1Database;
  AUTH_MODE?: string;
  // 任意。設定すると /setup にトークン入力を必須にする(CIデプロイ〜初回アクセスの間の乗っ取り対策)。
  SETUP_TOKEN?: string;
};

type AppContext = Context<{ Bindings: Bindings }>;

const app = new Hono<{ Bindings: Bindings }>();

function authEnabled(env: Bindings): env is Bindings & { DB: D1Database } {
  return env.AUTH_MODE === "password" && !!env.DB;
}

async function currentUser(c: AppContext, db: D1Database): Promise<DbUser | null> {
  const secret = await getSessionSecret(db);
  return getCurrentUser(c, db, secret);
}

async function loginAndRedirect(c: AppContext, db: D1Database, userId: string) {
  const secret = await getSessionSecret(db);
  const token = await createSessionToken(userId, secret);
  setSessionCookie(c, token);
  return c.redirect("/");
}

async function deleteBoardEverywhere(env: Bindings, id: string): Promise<void> {
  if (env.DB) await deleteBoardRow(env.DB, id);
  const doId = env.BOARD.idFromName(id);
  await env.BOARD.get(doId).fetch("https://board.internal/", { method: "DELETE" });
}

// 認証有効時に D1 へ登録・表示するボードIDの形式。管理画面等の HTML に埋め込むため、
// でたらめな文字列(記号・クォート類)を DB に入れない。モード0では制限しない(従来通り)。
function isValidBoardId(id: string): boolean {
  return /^[0-9A-Za-z_-]{1,64}$/.test(id);
}

// ログインID: 英数と . _ - のみ64文字以内。表示上の紛らわしさ(制御文字・空白・
// 同形異字)を排除するため、識別子は保守的な文字種に限定する。
const LOGIN_ID_RE = /^[0-9A-Za-z._-]{1,64}$/;

// 表示名: 制御文字と双方向テキスト制御文字(表示順の偽装に使える)を除去し、64文字以内に切り詰める。
function sanitizeDisplayName(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim()
    .slice(0, 64);
}

const ACCOUNT_INPUT_ERROR =
  "入力内容を確認してください(ログインIDは英数と . _ - の64文字以内、パスワードは8文字以上)";

type BoardAccess =
  | { kind: "editor"; userId: string; userName: string }
  | { kind: "guest-editor" }
  | { kind: "guest-viewer" }
  | { kind: "denied-login-required" }
  | { kind: "denied-not-found" };

// / (HTML)・/ws の両方で使う認可判定。ログイン済みなら常に許可(未登録ボードは
// creator_id=NULL で遅延登録)。未ログインは settings.guest_access に従い、
// ゲストは D1 に存在するボードにしかアクセスできない(遅延登録もしない = 適当な
// URL で新規 DO を生成させない)。
async function resolveBoardAccess(
  c: AppContext,
  db: D1Database,
  boardId: string,
): Promise<BoardAccess> {
  if (!isValidBoardId(boardId)) return { kind: "denied-not-found" };
  const user = await currentUser(c, db);
  if (user) {
    const board = await getBoard(db, boardId);
    if (board) {
      await touchBoard(db, boardId);
    } else {
      try {
        await createBoard(db, boardId, null);
      } catch {
        // 同時アクセスで既に登録済みだった場合は無視
        await touchBoard(db, boardId);
      }
    }
    return { kind: "editor", userId: user.id, userName: user.name };
  }
  const guestAccess = await getGuestAccess(db);
  if (guestAccess === "none") return { kind: "denied-login-required" };
  const board = await getBoard(db, boardId);
  if (!board) return { kind: "denied-not-found" };
  await touchBoard(db, boardId);
  return guestAccess === "view" ? { kind: "guest-viewer" } : { kind: "guest-editor" };
}

async function requireAdmin(
  c: AppContext,
): Promise<{ db: D1Database; user: DbUser } | Response> {
  if (!authEnabled(c.env)) return c.notFound();
  const db = c.env.DB;
  await ensureSchema(db);
  const user = await currentUser(c, db);
  if (!user) return c.redirect("/login");
  if (user.role !== "admin") return c.text("Forbidden", 403);
  return { db, user };
}

/* ---------- ホーム ---------- */

app.get("/", async (c) => {
  if (!authEnabled(c.env)) {
    // モード0: 従来通り新規ボードへ即リダイレクト
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
    return c.redirect(`/b/${id}`);
  }
  const db = c.env.DB;
  await ensureSchema(db);
  const user = await currentUser(c, db);
  if (!user) return c.redirect("/login");
  const boards = await listBoardsByCreator(db, user.id);
  return c.html(homePage({ user, boards }));
});

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "teamcanvas",
  }),
);

app.post("/boards/new", async (c) => {
  if (!authEnabled(c.env)) return c.notFound();
  const db = c.env.DB;
  await ensureSchema(db);
  const user = await currentUser(c, db);
  if (!user) return c.redirect("/login");
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  await createBoard(db, id, user.id);
  return c.redirect(`/b/${id}`);
});

app.post("/boards/:id/delete", async (c) => {
  if (!authEnabled(c.env)) return c.notFound();
  const db = c.env.DB;
  await ensureSchema(db);
  const user = await currentUser(c, db);
  if (!user) return c.redirect("/login");
  const id = c.req.param("id");
  const board = await getBoard(db, id);
  if (board && board.creator_id === user.id) {
    await deleteBoardEverywhere(c.env, id);
  }
  return c.redirect("/");
});

/* ---------- ボード画面 ---------- */

app.get("/b/:id", async (c) => {
  if (!authEnabled(c.env)) return c.html(boardHtml);
  const db = c.env.DB;
  await ensureSchema(db);
  const access = await resolveBoardAccess(c, db, c.req.param("id"));
  if (access.kind === "denied-login-required") return c.redirect("/login");
  if (access.kind === "denied-not-found") return c.notFound();
  return c.html(boardHtml);
});

app.get("/b/:id/ws", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("Expected websocket", 426);
  }
  const id = c.req.param("id");
  const doId = c.env.BOARD.idFromName(id);
  // クライアントが自分で付けた X-User-* ヘッダは信用しない(なりすまし防止)。
  // DO に渡る値は必ずこの Worker が設定したものだけにする。
  const headers = new Headers(c.req.raw.headers);
  headers.delete("X-User-Id");
  headers.delete("X-User-Name");
  headers.delete("X-User-Role");
  if (!authEnabled(c.env)) {
    // モード0: DO の挙動は完全に従来通り
    return c.env.BOARD.get(doId).fetch(new Request(c.req.raw, { headers }));
  }
  const db = c.env.DB;
  await ensureSchema(db);
  const access = await resolveBoardAccess(c, db, id);
  if (access.kind === "denied-login-required") {
    return c.text("Login required", 401);
  }
  if (access.kind === "denied-not-found") return c.notFound();

  if (access.kind === "editor") {
    headers.set("X-User-Id", access.userId);
    // 表示名は任意文字列なので、ヘッダに安全に載せられるよう URL エンコードして渡す
    headers.set("X-User-Name", encodeURIComponent(access.userName));
    headers.set("X-User-Role", "editor");
  } else if (access.kind === "guest-viewer") {
    headers.set("X-User-Role", "viewer");
  }
  // guest-editor はヘッダなし。DO 側が従来通り「ゲストN」を採番する。
  const req = new Request(c.req.raw, { headers });
  return c.env.BOARD.get(doId).fetch(req);
});

/* ---------- 初期設定(ブートストラップ) ---------- */

app.get("/setup", async (c) => {
  if (!authEnabled(c.env)) return c.notFound();
  const db = c.env.DB;
  await ensureSchema(db);
  const count = await countUsers(db);
  if (count > 0) return c.html(setupAlreadyDonePage());
  return c.html(setupFormPage({ requireToken: !!c.env.SETUP_TOKEN }));
});

app.post("/setup", async (c) => {
  if (!authEnabled(c.env)) return c.notFound();
  const db = c.env.DB;
  await ensureSchema(db);
  const requireToken = !!c.env.SETUP_TOKEN;
  if ((await countUsers(db)) > 0) return c.html(setupAlreadyDonePage());

  const form = await c.req.formData();
  const token = String(form.get("token") ?? "");
  const loginId = String(form.get("login_id") ?? "").trim();
  const name = sanitizeDisplayName(String(form.get("name") ?? ""));
  const password = String(form.get("password") ?? "");
  const password2 = String(form.get("password2") ?? "");

  if (requireToken && token !== c.env.SETUP_TOKEN) {
    return c.html(
      setupFormPage({ requireToken, error: "セットアップトークンが一致しません" }),
      403,
    );
  }
  if (!LOGIN_ID_RE.test(loginId) || !name || password.length < 8) {
    return c.html(
      setupFormPage({ requireToken, error: ACCOUNT_INPUT_ERROR }),
      400,
    );
  }
  if (password !== password2) {
    return c.html(
      setupFormPage({ requireToken, error: "パスワード(確認)が一致しません" }),
      400,
    );
  }

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  try {
    await createUser(db, { id, loginId, name, passwordHash, role: "admin" });
  } catch {
    return c.html(
      setupFormPage({ requireToken, error: "そのログインIDは既に使われています" }),
      400,
    );
  }
  return loginAndRedirect(c, db, id);
});

/* ---------- ログイン・ログアウト ---------- */

app.get("/login", async (c) => {
  if (!authEnabled(c.env)) return c.notFound();
  return c.html(loginPage({}));
});

app.post("/login", async (c) => {
  if (!authEnabled(c.env)) return c.notFound();
  const db = c.env.DB;
  await ensureSchema(db);
  const form = await c.req.formData();
  const loginId = String(form.get("login_id") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const user = await getUserByLoginId(db, loginId);
  if (
    !user ||
    user.status !== "active" ||
    !(await verifyPassword(password, user.password_hash))
  ) {
    return c.html(loginPage({ error: "ログインIDまたはパスワードが違います" }), 401);
  }
  return loginAndRedirect(c, db, user.id);
});

app.post("/logout", async (c) => {
  if (!authEnabled(c.env)) return c.notFound();
  clearSessionCookie(c);
  return c.redirect("/login");
});

/* ---------- 招待 ---------- */

app.get("/invite/:token", async (c) => {
  if (!authEnabled(c.env)) return c.notFound();
  const db = c.env.DB;
  await ensureSchema(db);
  const invite = await getInvite(db, c.req.param("token"));
  if (!invite || !isInviteValid(invite, Date.now())) {
    return c.html(inviteInvalidPage(), 404);
  }
  return c.html(invitePage({ token: invite.token }));
});

app.post("/invite/:token", async (c) => {
  if (!authEnabled(c.env)) return c.notFound();
  const db = c.env.DB;
  await ensureSchema(db);
  const tokenParam = c.req.param("token");
  const invite = await getInvite(db, tokenParam);
  if (!invite || !isInviteValid(invite, Date.now())) {
    return c.html(inviteInvalidPage(), 404);
  }

  const form = await c.req.formData();
  const loginId = String(form.get("login_id") ?? "").trim();
  const name = sanitizeDisplayName(String(form.get("name") ?? ""));
  const password = String(form.get("password") ?? "");
  const password2 = String(form.get("password2") ?? "");

  if (!LOGIN_ID_RE.test(loginId) || !name || password.length < 8) {
    return c.html(
      invitePage({ token: tokenParam, error: ACCOUNT_INPUT_ERROR }),
      400,
    );
  }
  if (password !== password2) {
    return c.html(
      invitePage({ token: tokenParam, error: "パスワード(確認)が一致しません" }),
      400,
    );
  }

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  try {
    await createUser(db, { id, loginId, name, passwordHash, role: "member" });
  } catch {
    return c.html(
      invitePage({ token: tokenParam, error: "そのログインIDは既に使われています" }),
      400,
    );
  }
  const consumed = await tryConsumeInvite(db, tokenParam, Date.now());
  if (!consumed) {
    // 直前の作成後、他リクエストと競合して使用枠を使い切っていた場合のロールバック
    await deleteUser(db, id);
    return c.html(inviteInvalidPage(), 410);
  }
  return loginAndRedirect(c, db, id);
});

/* ---------- 自分のパスワード変更 ---------- */

app.get("/me/password", async (c) => {
  if (!authEnabled(c.env)) return c.notFound();
  const db = c.env.DB;
  await ensureSchema(db);
  const user = await currentUser(c, db);
  if (!user) return c.redirect("/login");
  return c.html(passwordChangePage({ user }));
});

app.post("/me/password", async (c) => {
  if (!authEnabled(c.env)) return c.notFound();
  const db = c.env.DB;
  await ensureSchema(db);
  const user = await currentUser(c, db);
  if (!user) return c.redirect("/login");

  const form = await c.req.formData();
  const current = String(form.get("current_password") ?? "");
  const next = String(form.get("new_password") ?? "");
  const next2 = String(form.get("new_password2") ?? "");

  if (!(await verifyPassword(current, user.password_hash))) {
    return c.html(
      passwordChangePage({ user, error: "現在のパスワードが違います" }),
      400,
    );
  }
  if (next.length < 8) {
    return c.html(
      passwordChangePage({ user, error: "新しいパスワードは8文字以上にしてください" }),
      400,
    );
  }
  if (next !== next2) {
    return c.html(
      passwordChangePage({ user, error: "新しいパスワード(確認)が一致しません" }),
      400,
    );
  }
  const hash = await hashPassword(next);
  await updateUserPassword(db, user.id, hash);
  return c.html(passwordChangePage({ user, success: true }));
});

/* ---------- 管理画面 ---------- */

app.get("/admin", async (c) => {
  const r = await requireAdmin(c);
  if (r instanceof Response) return r;
  const { db, user } = r;
  const [boards, users, invites, guestAccess] = await Promise.all([
    listAllBoards(db),
    listUsers(db),
    listInvites(db),
    getGuestAccess(db),
  ]);
  const origin = new URL(c.req.url).origin;
  return c.html(adminPage({ user, boards, users, invites, guestAccess, origin }));
});

app.post("/admin/boards/:id/delete", async (c) => {
  const r = await requireAdmin(c);
  if (r instanceof Response) return r;
  await deleteBoardEverywhere(c.env, c.req.param("id"));
  return c.redirect("/admin");
});

app.post("/admin/users/:id/ban", async (c) => {
  const r = await requireAdmin(c);
  if (r instanceof Response) return r;
  const id = c.req.param("id");
  if (id !== r.user.id) await setUserStatus(r.db, id, "banned");
  return c.redirect("/admin");
});

app.post("/admin/users/:id/unban", async (c) => {
  const r = await requireAdmin(c);
  if (r instanceof Response) return r;
  await setUserStatus(r.db, c.req.param("id"), "active");
  return c.redirect("/admin");
});

app.post("/admin/users/:id/delete", async (c) => {
  const r = await requireAdmin(c);
  if (r instanceof Response) return r;
  const id = c.req.param("id");
  if (id !== r.user.id) await deleteUser(r.db, id);
  return c.redirect("/admin");
});

app.post("/admin/invites/new", async (c) => {
  const r = await requireAdmin(c);
  if (r instanceof Response) return r;
  const form = await c.req.formData();
  const email = String(form.get("email") ?? "").trim() || null;
  const days = Math.min(365, Math.max(1, Number(form.get("expires_days")) || 7));
  const maxUses = Math.min(1000, Math.max(1, Number(form.get("max_uses")) || 1));
  const token = crypto.randomUUID().replace(/-/g, "");
  await createInvite(r.db, {
    token,
    createdBy: r.user.id,
    email,
    expiresAt: Date.now() + days * 24 * 60 * 60 * 1000,
    maxUses,
  });
  return c.redirect("/admin");
});

app.post("/admin/invites/:token/delete", async (c) => {
  const r = await requireAdmin(c);
  if (r instanceof Response) return r;
  await deleteInvite(r.db, c.req.param("token"));
  return c.redirect("/admin");
});

app.post("/admin/settings/guest_access", async (c) => {
  const r = await requireAdmin(c);
  if (r instanceof Response) return r;
  const form = await c.req.formData();
  const value = String(form.get("guest_access") ?? "none");
  if (value === "none" || value === "view" || value === "edit") {
    await setSetting(r.db, "guest_access", value);
  }
  return c.redirect("/admin");
});

export default app;
export { BoardRoom } from "./room";
