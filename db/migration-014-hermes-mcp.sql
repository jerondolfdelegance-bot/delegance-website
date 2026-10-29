-- Hermes MCP tokens (POST /api/mcp/hermes). Separate from api_keys so a Hermes token can never reach the CRM MCP or REST API.
-- Only the sha256 hash is stored. Revoke: UPDATE hermes_keys SET revoked_at = datetime('now') WHERE id = '<id>';
CREATE TABLE IF NOT EXISTS hermes_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, prefix TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_used TEXT, revoked_at TEXT);
