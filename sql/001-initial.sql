BEGIN;
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name varchar(80) NOT NULL CHECK (length(trim(name))>0),
 email varchar(254) NOT NULL CHECK (email=lower(email)),
 password_hash varchar(60) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users(email);
CREATE TABLE sessions (
 token_hash bytea PRIMARY KEY CHECK(octet_length(token_hash)=32),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 csrf_token varchar(43) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE devices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name varchar(80) NOT NULL CHECK(length(trim(name))>0),
 device_type varchar(20) NOT NULL CHECK(device_type IN ('simulator','esp32','esp8266','raspberry-pi','other')),
 token_hash bytea NOT NULL UNIQUE CHECK(octet_length(token_hash)=32),
 token_ciphertext bytea NOT NULL,
 token_iv bytea NOT NULL CHECK(octet_length(token_iv)=12),
 token_tag bytea NOT NULL CHECK(octet_length(token_tag)=16),
 token_preview varchar(20) NOT NULL,
 token_version integer NOT NULL DEFAULT 1 CHECK(token_version>0),
 token_created_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz,
 disabled_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX devices_user_created_idx ON devices(user_id,created_at DESC,id);
-- UNIQUE(token_hash) supplies the fast indexed device-token lookup.
-- Online state is derived from last_seen_at and disabled_at; do not store a stale boolean.
CREATE TABLE audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 action varchar(50) NOT NULL,
 device_id uuid, -- retains deleted-device identity without blocking deletion
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_user_time ON audit_events(user_id,created_at DESC);
COMMIT;
