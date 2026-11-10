CREATE TABLE licenses (
  id            TEXT PRIMARY KEY,          -- "lic_" + 16 random base32 chars
  key_hash      TEXT NOT NULL UNIQUE,
  key_hint      TEXT NOT NULL,             -- last 4 chars
  plan          TEXT NOT NULL DEFAULT 'standard',
  max_devices   INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  revoke_reason TEXT,
  expires_at    INTEGER,                   -- unix seconds, NULL = lifetime
  note          TEXT,                      -- admin-only label, no personal data required
  created_at    INTEGER NOT NULL,
  revoked_at    INTEGER,
  resets_used   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE activations (
  id            TEXT PRIMARY KEY,          -- "act_" + 16 random base32
  license_id    TEXT NOT NULL REFERENCES licenses(id),
  device_hmac   TEXT NOT NULL,             -- HMAC-SHA256(FP_PEPPER, device_fp), hex
  device_label  TEXT,                      -- optional, user-chosen, max 32 chars
  client_version TEXT,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  token_gen     INTEGER NOT NULL DEFAULT 1, -- bump to invalidate this activation's tokens
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','released')),
  UNIQUE (license_id, device_hmac)
);
CREATE INDEX idx_act_license ON activations(license_id, status);
CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL,
  license_id TEXT, action TEXT NOT NULL, detail TEXT   -- no IPs, no raw fingerprints
);
