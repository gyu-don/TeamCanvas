// D1 スキーマ初期化とクエリ集。ランタイムで CREATE TABLE IF NOT EXISTS するので、
// デプロイヤーに migrations 実行を要求しない(認証を使わない人は本ファイルを一切呼ばない)。

export interface DbUser {
  id: string;
  login_id: string;
  name: string;
  password_hash: string;
  role: "admin" | "member";
  status: "active" | "banned";
  created_at: number;
}

export interface DbInvite {
  token: string;
  created_by: string;
  email: string | null;
  expires_at: number;
  used_at: number | null;
  max_uses: number;
  use_count: number;
}

export interface DbBoard {
  id: string;
  creator_id: string | null;
  created_at: number;
  last_active: number;
  // NULL はフェーズ3以前に作られたボード。"link" として扱う(従来挙動の維持)。
  visibility: string | null;
}

export type GuestAccess = "none" | "view" | "edit";

export type BoardVisibility = "link" | "tenant" | "restricted";

export type BoardMemberRole = "viewer" | "editor" | "owner";

export interface DbBoardMember {
  board_id: string;
  user_id: string;
  role: BoardMemberRole;
  added_at: number;
}

export interface DbBoardMemberWithUser extends DbBoardMember {
  name: string;
  login_id: string;
}

export interface DbMemberBoard extends DbBoard {
  member_role: BoardMemberRole;
}

export function normalizeVisibility(v: string | null | undefined): BoardVisibility {
  return v === "tenant" || v === "restricted" ? v : "link";
}

// isolate 内キャッシュ。D1 は isolate ごとに同じインスタンスが使い回されるので、
// リクエストのたびにスキーマ作成 DDL を投げないようにする。
let schemaReady = false;
let cachedSessionSecret: string | null = null;

export async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      login_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS invites (
      token TEXT PRIMARY KEY,
      created_by TEXT NOT NULL,
      email TEXT,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      max_uses INTEGER NOT NULL DEFAULT 1,
      use_count INTEGER NOT NULL DEFAULT 0
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      creator_id TEXT,
      created_at INTEGER NOT NULL,
      last_active INTEGER NOT NULL,
      visibility TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS board_members (
      board_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (board_id, user_id)
    )`),
  ]);
  try {
    // フェーズ1で作られた既存の boards テーブルに visibility 列を追加する。
    // 新規作成時は上の CREATE TABLE に含まれるため「duplicate column」で失敗するが無視してよい。
    await db.prepare("ALTER TABLE boards ADD COLUMN visibility TEXT").run();
  } catch {
    // 既に列がある場合
  }
  schemaReady = true;
}

// セッション署名用の HMAC 鍵。初回アクセス時に自動生成して settings に保存するので、
// secret の手動設定は不要。
export async function getSessionSecret(db: D1Database): Promise<string> {
  if (cachedSessionSecret) return cachedSessionSecret;
  let row = await db
    .prepare("SELECT value FROM settings WHERE key = 'session_secret'")
    .first<{ value: string }>();
  if (!row) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const secret = bytesToBase64Url(bytes);
    await db
      .prepare(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('session_secret', ?)",
      )
      .bind(secret)
      .run();
    row = await db
      .prepare("SELECT value FROM settings WHERE key = 'session_secret'")
      .first<{ value: string }>();
  }
  cachedSessionSecret = row!.value;
  return cachedSessionSecret;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* ---------- users ---------- */

export async function countUsers(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS c FROM users")
    .first<{ c: number }>();
  return row?.c ?? 0;
}

export async function getUserById(
  db: D1Database,
  id: string,
): Promise<DbUser | null> {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<DbUser>();
}

export async function getUserByLoginId(
  db: D1Database,
  loginId: string,
): Promise<DbUser | null> {
  return db
    .prepare("SELECT * FROM users WHERE login_id = ?")
    .bind(loginId)
    .first<DbUser>();
}

export async function createUser(
  db: D1Database,
  user: {
    id: string;
    loginId: string;
    name: string;
    passwordHash: string;
    role: "admin" | "member";
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (id, login_id, name, password_hash, role, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`,
    )
    .bind(user.id, user.loginId, user.name, user.passwordHash, user.role, Date.now())
    .run();
}

export async function listUsers(db: D1Database): Promise<DbUser[]> {
  const res = await db
    .prepare("SELECT * FROM users ORDER BY created_at ASC")
    .all<DbUser>();
  return res.results ?? [];
}

export async function updateUserPassword(
  db: D1Database,
  id: string,
  passwordHash: string,
): Promise<void> {
  await db
    .prepare("UPDATE users SET password_hash = ? WHERE id = ?")
    .bind(passwordHash, id)
    .run();
}

export async function setUserStatus(
  db: D1Database,
  id: string,
  status: "active" | "banned",
): Promise<void> {
  await db.prepare("UPDATE users SET status = ? WHERE id = ?").bind(status, id).run();
}

export async function deleteUser(db: D1Database, id: string): Promise<void> {
  // 本人の招待リンクも道連れに消す(削除済みユーザーの招待でアカウントを作られる穴を塞ぐ)。
  // ボード共有のメンバー登録も掃除する。作成済みボード自体は残す(削除は admin ができる)。
  await db.batch([
    db.prepare("DELETE FROM users WHERE id = ?").bind(id),
    db.prepare("DELETE FROM board_members WHERE user_id = ?").bind(id),
    db.prepare("DELETE FROM invites WHERE created_by = ?").bind(id),
  ]);
}

/* ---------- invites ---------- */

export async function createInvite(
  db: D1Database,
  invite: {
    token: string;
    createdBy: string;
    email: string | null;
    expiresAt: number;
    maxUses: number;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO invites (token, created_by, email, expires_at, max_uses, use_count)
       VALUES (?, ?, ?, ?, ?, 0)`,
    )
    .bind(invite.token, invite.createdBy, invite.email, invite.expiresAt, invite.maxUses)
    .run();
}

export async function getInvite(
  db: D1Database,
  token: string,
): Promise<DbInvite | null> {
  return db
    .prepare("SELECT * FROM invites WHERE token = ?")
    .bind(token)
    .first<DbInvite>();
}

// 条件付き UPDATE で消費する。同時アクセスで use_count が競合しても
// max_uses を超えて消費されないようにするための唯一の判定点。
export async function tryConsumeInvite(
  db: D1Database,
  token: string,
  now: number,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE invites SET use_count = use_count + 1, used_at = ?
       WHERE token = ? AND expires_at > ? AND use_count < max_uses`,
    )
    .bind(now, token, now)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function listInvites(db: D1Database): Promise<DbInvite[]> {
  const res = await db
    .prepare("SELECT * FROM invites ORDER BY expires_at DESC")
    .all<DbInvite>();
  return res.results ?? [];
}

export async function listInvitesByCreator(
  db: D1Database,
  createdBy: string,
): Promise<DbInvite[]> {
  const res = await db
    .prepare("SELECT * FROM invites WHERE created_by = ? ORDER BY expires_at DESC")
    .bind(createdBy)
    .all<DbInvite>();
  return res.results ?? [];
}

export async function deleteInvite(db: D1Database, token: string): Promise<void> {
  await db.prepare("DELETE FROM invites WHERE token = ?").bind(token).run();
}

export function isInviteValid(invite: DbInvite, now: number): boolean {
  return invite.expires_at > now && invite.use_count < invite.max_uses;
}

/* ---------- boards ---------- */

export async function getBoard(db: D1Database, id: string): Promise<DbBoard | null> {
  return db.prepare("SELECT * FROM boards WHERE id = ?").bind(id).first<DbBoard>();
}

export async function createBoard(
  db: D1Database,
  id: string,
  creatorId: string | null,
  visibility: BoardVisibility = "link",
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO boards (id, creator_id, created_at, last_active, visibility)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, creatorId, now, now, visibility)
    .run();
}

export async function touchBoard(db: D1Database, id: string): Promise<void> {
  await db
    .prepare("UPDATE boards SET last_active = ? WHERE id = ?")
    .bind(Date.now(), id)
    .run();
}

export async function listBoardsByCreator(
  db: D1Database,
  creatorId: string,
): Promise<DbBoard[]> {
  const res = await db
    .prepare("SELECT * FROM boards WHERE creator_id = ? ORDER BY last_active DESC")
    .bind(creatorId)
    .all<DbBoard>();
  return res.results ?? [];
}

export async function countBoardsByCreator(
  db: D1Database,
  creatorId: string,
): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS c FROM boards WHERE creator_id = ?")
    .bind(creatorId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

export async function setBoardVisibility(
  db: D1Database,
  id: string,
  visibility: BoardVisibility,
): Promise<void> {
  await db
    .prepare("UPDATE boards SET visibility = ? WHERE id = ?")
    .bind(visibility, id)
    .run();
}

// 自分がメンバー登録されているボード(自分が作成者のものは「マイボード」側に出るので除外)
export async function listBoardsByMember(
  db: D1Database,
  userId: string,
): Promise<DbMemberBoard[]> {
  const res = await db
    .prepare(
      `SELECT b.*, m.role AS member_role FROM boards b
       JOIN board_members m ON m.board_id = b.id
       WHERE m.user_id = ? AND (b.creator_id IS NULL OR b.creator_id != ?)
       ORDER BY b.last_active DESC`,
    )
    .bind(userId, userId)
    .all<DbMemberBoard>();
  return res.results ?? [];
}

export async function listAllBoards(db: D1Database): Promise<DbBoard[]> {
  const res = await db
    .prepare("SELECT * FROM boards ORDER BY last_active DESC")
    .all<DbBoard>();
  return res.results ?? [];
}

export async function deleteBoardRow(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM boards WHERE id = ?").bind(id),
    db.prepare("DELETE FROM board_members WHERE board_id = ?").bind(id),
  ]);
}

/* ---------- board_members ---------- */

export async function getBoardMember(
  db: D1Database,
  boardId: string,
  userId: string,
): Promise<DbBoardMember | null> {
  return db
    .prepare("SELECT * FROM board_members WHERE board_id = ? AND user_id = ?")
    .bind(boardId, userId)
    .first<DbBoardMember>();
}

export async function listBoardMembers(
  db: D1Database,
  boardId: string,
): Promise<DbBoardMemberWithUser[]> {
  const res = await db
    .prepare(
      `SELECT m.*, u.name, u.login_id FROM board_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.board_id = ? ORDER BY m.added_at ASC`,
    )
    .bind(boardId)
    .all<DbBoardMemberWithUser>();
  return res.results ?? [];
}

// 追加と役割変更を兼ねる(既存メンバーなら role を上書き)
export async function upsertBoardMember(
  db: D1Database,
  boardId: string,
  userId: string,
  role: BoardMemberRole,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO board_members (board_id, user_id, role, added_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(board_id, user_id) DO UPDATE SET role = excluded.role`,
    )
    .bind(boardId, userId, role, Date.now())
    .run();
}

export async function deleteBoardMember(
  db: D1Database,
  boardId: string,
  userId: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM board_members WHERE board_id = ? AND user_id = ?")
    .bind(boardId, userId)
    .run();
}

/* ---------- settings ---------- */

export async function getSetting(
  db: D1Database,
  key: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(
  db: D1Database,
  key: string,
  value: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .bind(key, value)
    .run();
}

export async function getGuestAccess(db: D1Database): Promise<GuestAccess> {
  const v = await getSetting(db, "guest_access");
  if (v === "view" || v === "edit") return v;
  return "none";
}

// ユーザーあたりのボード数上限。0 は無制限(デフォルト)。admin には適用しない。
export async function getMaxBoardsPerUser(db: D1Database): Promise<number> {
  const v = await getSetting(db, "max_boards_per_user");
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

// member にも招待リンクの発行を許可するか(デフォルト off)
export async function isMemberInviteEnabled(db: D1Database): Promise<boolean> {
  return (await getSetting(db, "member_invite")) === "1";
}

// 新規ボードのデフォルト visibility。フェーズ3で guest_access を「新規ボードの
// デフォルト値」に昇格させた: ゲストに閉じている(none)なら tenant、
// ゲストに開いている(view/edit)なら従来通りのリンク共有(link)で作る。
export async function getDefaultBoardVisibility(
  db: D1Database,
): Promise<BoardVisibility> {
  const ga = await getGuestAccess(db);
  return ga === "none" ? "tenant" : "link";
}
