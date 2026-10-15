-- Sign-in upgrade: passkeys (Face ID, fingerprint, Windows Hello). Email codes reuse auth_tokens.
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,            -- credential id (base64url)
  user_id TEXT NOT NULL,
  public_key TEXT NOT NULL,       -- JWK JSON
  alg INTEGER NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  name TEXT,
  created_at TEXT NOT NULL,
  last_used TEXT
);
CREATE INDEX IF NOT EXISTS passkeys_user ON passkeys(user_id);
