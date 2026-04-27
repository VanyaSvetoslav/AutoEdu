import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { config } from './config.js';
import { decrypt, encrypt } from './crypto.js';

mkdirSync(dirname(config.DB_PATH), { recursive: true });

export const db = new Database(config.DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    tg_id        INTEGER PRIMARY KEY,
    role         TEXT    NOT NULL DEFAULT 'user',
    used_key     TEXT,
    joined_at    INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invite_keys (
    key         TEXT PRIMARY KEY,
    created_by  INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    used_by     INTEGER,
    used_at     INTEGER,
    revoked     INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS mosreg_credentials (
    id                  INTEGER PRIMARY KEY CHECK (id = 1),
    encrypted_token     TEXT,
    encrypted_cookie    TEXT,
    student_id          TEXT,
    profile_id          TEXT,
    updated_at          INTEGER
  );

  INSERT OR IGNORE INTO mosreg_credentials (id) VALUES (1);
`);

export type UserRow = {
  tg_id: number;
  role: 'admin' | 'user';
  used_key: string | null;
  joined_at: number;
  last_seen_at: number;
};

export type InviteKeyRow = {
  key: string;
  created_by: number;
  created_at: number;
  used_by: number | null;
  used_at: number | null;
  revoked: number;
};

const stmts = {
  getUser: db.prepare<[number], UserRow>('SELECT * FROM users WHERE tg_id = ?'),
  upsertUser: db.prepare(`
    INSERT INTO users (tg_id, role, used_key, joined_at, last_seen_at)
    VALUES (@tg_id, @role, @used_key, @joined_at, @last_seen_at)
    ON CONFLICT(tg_id) DO UPDATE SET last_seen_at = excluded.last_seen_at
  `),
  touchUser: db.prepare('UPDATE users SET last_seen_at = ? WHERE tg_id = ?'),
  listUsers: db.prepare<[], UserRow>('SELECT * FROM users ORDER BY joined_at DESC'),

  insertKey: db.prepare('INSERT INTO invite_keys (key, created_by, created_at) VALUES (?, ?, ?)'),
  getKey: db.prepare<[string], InviteKeyRow>('SELECT * FROM invite_keys WHERE key = ?'),
  consumeKey: db.prepare(
    'UPDATE invite_keys SET used_by = ?, used_at = ? WHERE key = ? AND used_by IS NULL AND revoked = 0',
  ),
  revokeKey: db.prepare('UPDATE invite_keys SET revoked = 1 WHERE key = ?'),
  listKeys: db.prepare<[], InviteKeyRow>(
    'SELECT * FROM invite_keys ORDER BY created_at DESC LIMIT 50',
  ),

  setToken: db.prepare(
    'UPDATE mosreg_credentials SET encrypted_token = ?, updated_at = ? WHERE id = 1',
  ),
  setCookie: db.prepare(
    'UPDATE mosreg_credentials SET encrypted_cookie = ?, updated_at = ? WHERE id = 1',
  ),
  setStudent: db.prepare(
    'UPDATE mosreg_credentials SET student_id = ?, profile_id = ?, updated_at = ? WHERE id = 1',
  ),
  getCreds: db.prepare<
    [],
    {
      encrypted_token: string | null;
      encrypted_cookie: string | null;
      student_id: string | null;
      profile_id: string | null;
      updated_at: number | null;
    }
  >(
    'SELECT encrypted_token, encrypted_cookie, student_id, profile_id, updated_at FROM mosreg_credentials WHERE id = 1',
  ),
};

const now = (): number => Math.floor(Date.now() / 1000);

export function ensureUser(tgId: number, role: 'admin' | 'user', usedKey: string | null): UserRow {
  const existing = stmts.getUser.get(tgId);
  if (existing) {
    stmts.touchUser.run(now(), tgId);
    return existing;
  }
  const t = now();
  stmts.upsertUser.run({
    tg_id: tgId,
    role,
    used_key: usedKey,
    joined_at: t,
    last_seen_at: t,
  });
  return stmts.getUser.get(tgId)!;
}

export function getUser(tgId: number): UserRow | undefined {
  return stmts.getUser.get(tgId);
}

export function touchUser(tgId: number): void {
  stmts.touchUser.run(now(), tgId);
}

export function listUsers(): UserRow[] {
  return stmts.listUsers.all();
}

export function createInviteKey(key: string, createdBy: number): void {
  stmts.insertKey.run(key, createdBy, now());
}

export function getInviteKey(key: string): InviteKeyRow | undefined {
  return stmts.getKey.get(key);
}

export function consumeInviteKey(key: string, usedBy: number): boolean {
  const res = stmts.consumeKey.run(usedBy, now(), key);
  return res.changes === 1;
}

export function revokeInviteKey(key: string): boolean {
  return stmts.revokeKey.run(key).changes === 1;
}

export function listInviteKeys(): InviteKeyRow[] {
  return stmts.listKeys.all();
}

export type MosregCredentials = {
  token: string | null;
  cookie: string | null;
  studentId: string | null;
  profileId: string | null;
  updatedAt: number | null;
};

export function getMosregCredentials(): MosregCredentials {
  const row = stmts.getCreds.get();
  return {
    token: row?.encrypted_token ? decrypt(row.encrypted_token) : null,
    cookie: row?.encrypted_cookie ? decrypt(row.encrypted_cookie) : null,
    studentId: row?.student_id ?? null,
    profileId: row?.profile_id ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

export function setMosregToken(token: string): void {
  stmts.setToken.run(encrypt(token), now());
}

export function setMosregCookie(cookie: string): void {
  stmts.setCookie.run(encrypt(cookie), now());
}

export function setMosregStudent(studentId: string, profileId: string): void {
  stmts.setStudent.run(studentId, profileId, now());
}
