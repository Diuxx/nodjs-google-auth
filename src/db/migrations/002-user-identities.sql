CREATE TABLE users_next (
  id INTEGER PRIMARY KEY,
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  primary_provider TEXT NOT NULL,
  display_name TEXT,
  picture_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO users_next (id, email, email_verified, primary_provider, display_name, picture_url, created_at, updated_at)
SELECT id, email, 1, 'google', display_name, picture_url, created_at, updated_at FROM users;

CREATE TABLE user_identities (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_user_id),
  UNIQUE (user_id, provider)
);
INSERT INTO user_identities (user_id, provider, provider_user_id, created_at)
SELECT id, 'google', google_sub, created_at FROM users;
DROP TABLE users;
ALTER TABLE users_next RENAME TO users;

CREATE TABLE oauth_flows_next (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  flow_type TEXT NOT NULL CHECK (flow_type IN ('login', 'drive', 'link')),
  provider TEXT NOT NULL,
  app_id TEXT NOT NULL,
  return_to TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
INSERT INTO oauth_flows_next
SELECT state_hash, browser_hash, flow_type, 'google', app_id, return_to, code_verifier, nonce, user_id, expires_at
FROM oauth_flows;
DROP TABLE oauth_flows;
ALTER TABLE oauth_flows_next RENAME TO oauth_flows;
CREATE INDEX oauth_flows_expires_idx ON oauth_flows(expires_at);
