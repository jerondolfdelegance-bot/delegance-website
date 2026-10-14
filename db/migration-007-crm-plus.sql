-- Delegance CRM v2: deals, activity types, priorities, notifications, email templates.
CREATE TABLE IF NOT EXISTS crm_deals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  contact_id TEXT,
  owner_id TEXT,
  stage TEXT NOT NULL DEFAULT 'new',          -- new | contacted | call | proposal | negotiation | won | lost
  value_usd INTEGER,
  probability INTEGER,                        -- null = stage default
  close_date TEXT,
  lost_reason TEXT,
  source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  stage_changed_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON crm_deals(stage, updated_at);
CREATE INDEX IF NOT EXISTS idx_deals_contact ON crm_deals(contact_id);
ALTER TABLE crm_notes ADD COLUMN kind TEXT NOT NULL DEFAULT 'note';   -- note | call | meeting | email | system
ALTER TABLE crm_notes ADD COLUMN deal_id TEXT;
ALTER TABLE crm_tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE crm_tasks ADD COLUMN deal_id TEXT;
ALTER TABLE crm_contacts ADD COLUMN last_activity TEXT;
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at);
CREATE TABLE IF NOT EXISTS email_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL
);
-- Existing pipeline positions become deals.
INSERT INTO crm_deals (id, title, contact_id, owner_id, stage, value_usd, source, created_at, updated_at, stage_changed_at, closed_at)
  SELECT 'dl_' || substr(id, 4), COALESCE(company, name) || ' deal', id, owner_id, stage, value_usd, source, created_at, updated_at, updated_at,
         CASE WHEN stage IN ('won','lost') THEN updated_at END
  FROM crm_contacts WHERE id NOT IN (SELECT contact_id FROM crm_deals WHERE contact_id IS NOT NULL);
UPDATE crm_contacts SET last_activity = updated_at WHERE last_activity IS NULL;
