-- Delegance v3: automations, integrations (API keys, webhooks, lead capture), Claude MCP, booking.
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, prefix TEXT NOT NULL, hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL DEFAULT 'write', created_at TEXT NOT NULL, last_used TEXT, revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY, name TEXT, url TEXT NOT NULL, events TEXT NOT NULL DEFAULT '["*"]', secret TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, created_by TEXT, created_at TEXT NOT NULL, last_status INTEGER, last_at TEXT, fails INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS lead_hooks (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL, source TEXT, make_deal INTEGER NOT NULL DEFAULT 1,
  created_by TEXT, created_at TEXT NOT NULL, last_used TEXT, count INTEGER NOT NULL DEFAULT 0, revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS automations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, trigger TEXT NOT NULL, trigger_value TEXT,
  conditions TEXT NOT NULL DEFAULT '[]', actions TEXT NOT NULL DEFAULT '[]', created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  runs INTEGER NOT NULL DEFAULT 0, last_run TEXT
);
CREATE TABLE IF NOT EXISTS automation_queue (
  id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, step INTEGER NOT NULL, ctx TEXT NOT NULL, run_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting', attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aq_due ON automation_queue(status, run_at);
CREATE TABLE IF NOT EXISTS automation_log (
  id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, subject TEXT, status TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alog ON automation_log(automation_id, created_at);
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY, contact_id TEXT, host_id TEXT, deal_id TEXT, start_at TEXT NOT NULL, end_at TEXT NOT NULL,
  name TEXT NOT NULL, email TEXT NOT NULL, company TEXT, notes TEXT, tz TEXT, status TEXT NOT NULL DEFAULT 'booked',
  cancel_hash TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_book_start ON bookings(start_at, status);
