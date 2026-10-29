import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { sql, dbEnabled } from './db.js';
import { initUserState } from './store.js';

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'mm_session';
const SESSION_DAYS = 30;

export class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const authEnabled = () => dbEnabled;

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

function validate({ email, name, password }) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
    throw new AuthError(400, '请输入有效的邮箱地址');
  }
  if (!name || name.length > 60) throw new AuthError(400, '请输入 1–60 个字符的称呼');
  if (!password || password.length < 8) throw new AuthError(400, '密码至少 8 位');
  if (password.length > 128) throw new AuthError(400, '密码不能超过 128 位');
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export async function initAuth() {
  if (!dbEnabled) {
    console.log('[auth] 未配置 DATABASE_URL，使用本地免登录模式');
    return false;
  }
  await sql`CREATE TABLE IF NOT EXISTS mockmirror_users (
    id uuid PRIMARY KEY,
    email varchar(160) UNIQUE NOT NULL,
    name varchar(60) NOT NULL,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS mockmirror_auth_sessions (
    token_hash char(64) PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES mockmirror_users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS mockmirror_auth_sessions_user_idx
             ON mockmirror_auth_sessions (user_id, expires_at)`;
  await sql`CREATE TABLE IF NOT EXISTS mockmirror_user_state (
    user_id uuid PRIMARY KEY REFERENCES mockmirror_users(id) ON DELETE CASCADE,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;
  console.log('[auth] 用户与会话表就绪');
  return true;
}

export async function register({ email: rawEmail, name: rawName, password }) {
  if (!dbEnabled) throw new AuthError(503, '当前是本地模式，未启用账号系统');
  const email = normalizeEmail(rawEmail);
  const name = String(rawName || '').trim();
  validate({ email, name, password });
  const countRows = await sql`SELECT count(*)::int AS n FROM mockmirror_users`;
  const first = Number(countRows[0]?.n || 0) === 0;
  const existing = await sql`SELECT id FROM mockmirror_users WHERE email = ${email}`;
  if (existing.length) throw new AuthError(409, '这个邮箱已经注册，请直接登录');
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  try {
    await sql`INSERT INTO mockmirror_users (id, email, name, password_hash)
              VALUES (${id}, ${email}, ${name}, ${passwordHash})`;
  } catch (err) {
    if (err.code === '23505') throw new AuthError(409, '这个邮箱已经注册，请直接登录');
    throw err;
  }
  await initUserState(id, { withEnvKey: true, legacy: first });
  return { id, email, name };
}

export async function login({ email: rawEmail, password }) {
  if (!dbEnabled) throw new AuthError(503, '当前是本地模式，未启用账号系统');
  const email = normalizeEmail(rawEmail);
  if (!email || !password) throw new AuthError(400, '请输入邮箱和密码');
  const rows = await sql`SELECT id, email, name, password_hash FROM mockmirror_users WHERE email = ${email}`;
  const user = rows[0];
  const ok = user && await verifyPassword(password, user.password_hash);
  if (!ok) throw new AuthError(401, '邮箱或密码不正确');
  return { id: user.id, email: user.email, name: user.name };
}

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await sql`INSERT INTO mockmirror_auth_sessions (token_hash, user_id, expires_at)
            VALUES (${tokenHash}, ${userId}, ${expiresAt.toISOString()})`;
  return { token, expiresAt };
}

export async function deleteSession(token) {
  if (!token || !dbEnabled) return;
  await sql`DELETE FROM mockmirror_auth_sessions WHERE token_hash = ${hashToken(token)}`;
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const value = part.slice(i + 1).trim();
    try { out[part.slice(0, i).trim()] = decodeURIComponent(value); }
    catch { out[part.slice(0, i).trim()] = value; }
  }
  return out;
}

export function sessionToken(req) {
  return parseCookies(req)[COOKIE] || '';
}

export async function currentUser(req) {
  if (!dbEnabled) return null;
  const token = sessionToken(req);
  if (!token) return null;
  const rows = await sql`SELECT u.id, u.email, u.name, s.expires_at
                         FROM mockmirror_auth_sessions s
                         JOIN mockmirror_users u ON u.id = s.user_id
                         WHERE s.token_hash = ${hashToken(token)}
                           AND s.expires_at > now()`;
  if (!rows[0]) {
    await deleteSession(token);
    return null;
  }
  return { id: rows[0].id, email: rows[0].email, name: rows[0].name };
}

const isSecure = () => process.env.NODE_ENV === 'production' ||
  Boolean(process.env.RENDER) ||
  String(process.env.SITE_URL || '').startsWith('https://');

export function setSessionCookie(res, token) {
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 86400}`
  ];
  if (isSecure()) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res) {
  const parts = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isSecure()) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
