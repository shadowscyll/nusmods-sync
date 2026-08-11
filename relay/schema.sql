CREATE TABLE IF NOT EXISTS vaults (
  vault_id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL,
  envelope_json TEXT,
  client_updated_at INTEGER,
  device_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vaults_expires_at ON vaults(expires_at);

CREATE TABLE IF NOT EXISTS pairing_handoffs (
  pairing_id TEXT PRIMARY KEY NOT NULL,
  envelope_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pairing_handoffs_expires_at ON pairing_handoffs(expires_at);

CREATE TABLE IF NOT EXISTS friend_shares (
  share_id TEXT PRIMARY KEY NOT NULL,
  read_token_hash TEXT NOT NULL,
  write_token_hash TEXT NOT NULL,
  envelope_json TEXT,
  client_updated_at INTEGER,
  device_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_friend_shares_expires_at ON friend_shares(expires_at);
