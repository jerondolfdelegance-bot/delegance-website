-- Delegance Accounts + CRM (v1). Shares the delegance-desk D1 database.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',        -- super_admin | admin | staff | va | client | member
  status TEXT NOT NULL DEFAULT 'active',      -- active | invited | disabled
  title TEXT,
  pass_hash TEXT,
  pass_salt TEXT,
  candidate_id TEXT,                          -- VA: linked candidates.id
  contact_id TEXT,                            -- client: linked crm_contacts.id
  failed INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                        -- sha256 of the cookie token
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  ua TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS auth_tokens (
  id TEXT PRIMARY KEY,                        -- sha256 of the link token
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,                         -- invite | reset
  expires_at INTEGER NOT NULL,
  used_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS crm_contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT,
  email TEXT,
  phone TEXT,
  country TEXT,
  source TEXT,                                -- website request | referral | chat | manual ...
  stage TEXT NOT NULL DEFAULT 'new',          -- new | contacted | call | proposal | won | lost
  kind TEXT NOT NULL DEFAULT 'lead',          -- lead | client | partner
  owner_id TEXT,
  value_usd INTEGER,
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crm_stage ON crm_contacts(stage, updated_at);
CREATE TABLE IF NOT EXISTS crm_notes (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  author_id TEXT,
  author_name TEXT,
  visibility TEXT NOT NULL DEFAULT 'internal', -- internal | client
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_contact ON crm_notes(contact_id, created_at);
CREATE TABLE IF NOT EXISTS crm_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  contact_id TEXT,
  assignee_id TEXT,
  due TEXT,
  status TEXT NOT NULL DEFAULT 'open',        -- open | doing | done
  client_visible INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON crm_tasks(assignee_id, status);
CREATE TABLE IF NOT EXISTS crm_requests (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  user_id TEXT,
  title TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'new',         -- new | in_progress | done | closed
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS va_assignments (
  va_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (va_id, contact_id)
);
CREATE TABLE IF NOT EXISTS timesheets (
  id TEXT PRIMARY KEY,
  va_id TEXT NOT NULL,
  contact_id TEXT,
  day TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ts_va ON timesheets(va_id, day);
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all',       -- all | team | va | client | member
  author_name TEXT,
  created_at TEXT NOT NULL
);
