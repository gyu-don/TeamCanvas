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
}

export type GuestAccess = "none" | "view" | "edit";

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
      last_active INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`),
  ]);
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
  await db.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
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
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO boards (id, creator_id, created_at, last_active) VALUES (?, ?, ?, ?)`,
    )
    .bind(id, creatorId, now, now)
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

export async function listAllBoards(db: D1Database): Promise<DbBoard[]> {
  const res = await db
    .prepare("SELECT * FROM boards ORDER BY last_active DESC")
    .all<DbBoard>();
  return res.results ?? [];
}

export async function deleteBoardRow(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM boards WHERE id = ?").bind(id).run();
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
