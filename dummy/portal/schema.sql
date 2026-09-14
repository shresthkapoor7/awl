PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('clerk','supervisor','viewer')),
 failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
 access_hash TEXT UNIQUE NOT NULL, access_expires INTEGER NOT NULL,
 csrf TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
 expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, scenario TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
 token_hash TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
 expires_at INTEGER NOT NULL, used_at INTEGER
);
CREATE INDEX IF NOT EXISTS refresh_session ON refresh_tokens(session_id);
CREATE TABLE IF NOT EXISTS members (
 id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('ACTIVE','RESTRICTED','CLOSED')),
 joined TEXT NOT NULL, branch TEXT NOT NULL, address TEXT NOT NULL, city TEXT NOT NULL,
 state TEXT NOT NULL, postal TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS accounts (
 id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), product TEXT NOT NULL,
 nickname TEXT NOT NULL, balance_cents INTEGER NOT NULL CHECK(balance_cents >= 0),
 status TEXT NOT NULL DEFAULT 'OPEN', opened TEXT NOT NULL,
 UNIQUE(member_id, product)
);
CREATE TABLE IF NOT EXISTS ledger (
 id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL REFERENCES accounts(id),
 reference TEXT NOT NULL, description TEXT NOT NULL, amount_cents INTEGER NOT NULL,
 balance_cents INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE TABLE IF NOT EXISTS drafts (
 id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), user_id INTEGER NOT NULL REFERENCES users(id),
 product TEXT NOT NULL, nickname TEXT NOT NULL, source_id TEXT NOT NULL REFERENCES accounts(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), member_version INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'REVIEW' CHECK(state IN ('REVIEW','POSTED','CANCELLED')),
 approved_by INTEGER REFERENCES users(id), approved_at TEXT,
 account_id TEXT REFERENCES accounts(id), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE TABLE IF NOT EXISTS notes (
 id INTEGER PRIMARY KEY AUTOINCREMENT, member_id TEXT NOT NULL REFERENCES members(id),
 user_id INTEGER NOT NULL REFERENCES users(id), category TEXT NOT NULL, body TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
CREATE TABLE IF NOT EXISTS audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id),
 event TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);
