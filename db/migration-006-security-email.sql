-- Delegance Accounts v1.1: 2-step sign-in, session places, notification settings.
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_pending TEXT;
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN totp_step INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN recovery TEXT;
ALTER TABLE users ADD COLUMN notify INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sessions ADD COLUMN place TEXT;
ALTER TABLE sessions ADD COLUMN last_seen TEXT;
