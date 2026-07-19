// パスワードハッシュ(PBKDF2-SHA256)とセッション Cookie(HMAC-SHA256 署名)。
// WebCrypto のみを使い、外部ライブラリには依存しない。
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { getUserById, type DbUser } from "./db";

const PBKDF2_ITERATIONS = 100_000;
const SESSION_COOKIE = "sid";
const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30日

/* ---------- base64url ---------- */

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function strToBase64Url(s: string): string {
  return bytesToBase64Url(new TextEncoder().encode(s));
}

function base64UrlToStr(s: string): string {
  return new TextDecoder().decode(base64UrlToBytes(s));
}

// タイミング攻撃を避けるための定数時間比較。
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* ---------- パスワードハッシュ ---------- */

async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

// 保存形式: pbkdf2:<iterations>:<salt_b64url>:<hash_b64url>
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2:${PBKDF2_ITERATIONS}:${bytesToBase64Url(salt)}:${bytesToBase64Url(hash)}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  const salt = base64UrlToBytes(parts[2]);
  const expected = base64UrlToBytes(parts[3]);
  const actual = await pbkdf2(password, salt, iterations);
  return constantTimeEqual(actual, expected);
}

/* ---------- セッション Cookie ---------- */

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function hmacSign(payload: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return bytesToBase64Url(new Uint8Array(sig));
}

export async function createSessionToken(
  uid: string,
  secret: string,
): Promise<string> {
  const exp = Date.now() + SESSION_MAX_AGE_SEC * 1000;
  const payload = strToBase64Url(JSON.stringify({ uid, exp }));
  const sig = await hmacSign(payload, secret);
  return `${payload}.${sig}`;
}

export async function verifySessionToken(
  token: string,
  secret: string,
): Promise<{ uid: string; exp: number } | null> {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expectedSig = await hmacSign(payload, secret);
  if (!constantTimeEqual(base64UrlToBytes(sig), base64UrlToBytes(expectedSig))) {
    return null;
  }
  try {
    const data = JSON.parse(base64UrlToStr(payload));
    if (typeof data.uid !== "string" || typeof data.exp !== "number") return null;
    if (Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

// biome-ignore lint: Hono Context の Bindings/Variables は呼び出し側で異なるため any で受ける
export function setSessionCookie(c: Context<any>, token: string): void {
  // ローカル開発(wrangler dev は http)でも curl 等で動作確認できるよう、
  // https 経由のリクエストのときだけ Secure 属性を付ける。本番(Workers)は常に https。
  const secure = new URL(c.req.url).protocol === "https:";
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
}

// biome-ignore lint: 同上
export function clearSessionCookie(c: Context<any>): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

// Cookie を検証し、有効かつ banned でないユーザーを返す。
// D1 を毎回引くのは BAN の即時反映のため(仕様上必須)。
export async function getCurrentUser(
  // biome-ignore lint: 同上
  c: Context<any>,
  db: D1Database,
  secret: string,
): Promise<DbUser | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const data = await verifySessionToken(token, secret);
  if (!data) return null;
  const user = await getUserById(db, data.uid);
  if (!user || user.status !== "active") return null;
  return user;
}
