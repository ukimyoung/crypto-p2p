-- Authentication: password login, sessions, login history, app OTP (AUTH-1, AUTH-3).

ALTER TABLE users
  ADD COLUMN password_hash     text,
  ADD COLUMN otp_secret_enc    text,              -- AES-256-GCM encrypted TOTP secret
  ADD COLUMN otp_enabled       boolean NOT NULL DEFAULT false,
  ADD COLUMN otp_last_counter  bigint;            -- last accepted TOTP step, blocks code replay

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  token_hash  bytea NOT NULL UNIQUE,              -- sha256 of the bearer token; the token itself is never stored
  ip          inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);

CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE login_attempts (
  id          bigserial PRIMARY KEY,
  email       text NOT NULL,
  user_id     uuid REFERENCES users(id),
  success     boolean NOT NULL,
  reason      text,
  ip          inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX login_attempts_email_idx ON login_attempts (email, created_at);
