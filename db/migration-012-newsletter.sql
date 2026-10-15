-- Newsletter with double opt-in (subscribe -> confirm by email -> active; one-click unsubscribe).
CREATE TABLE IF NOT EXISTS newsletter (
  email TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | active | unsubscribed
  confirm_hash TEXT,
  unsub_token TEXT NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS newsletter_status ON newsletter(status);
