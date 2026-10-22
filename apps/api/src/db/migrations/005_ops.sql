-- Operations console: staff accounts, dispute decisions, account restrictions.

-- Staff log in separately from customers. OTP is mandatory, so the secret is set at creation.
CREATE TABLE operators (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text NOT NULL UNIQUE,
  name              text NOT NULL,
  role              text NOT NULL CHECK (role IN ('support', 'reviewer', 'admin')),
  password_hash     text NOT NULL,
  otp_secret_enc    text NOT NULL,
  otp_last_counter  bigint,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE operator_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id  uuid NOT NULL REFERENCES operators(id),
  token_hash   bytea NOT NULL UNIQUE,
  ip           inet,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);

CREATE TABLE operator_login_attempts (
  id          bigserial PRIMARY KEY,
  email       text NOT NULL,
  success     boolean NOT NULL,
  reason      text,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX operator_login_attempts_email_idx ON operator_login_attempts (email, created_at);

-- Dispute decisions need two operators: one proposes, a different one approves (PRD section 7).
CREATE TABLE dispute_resolutions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES orders(id),
  decision     text NOT NULL CHECK (decision IN ('release', 'refund')),
  reason       text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
  status       text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'declined')),
  proposed_by  uuid NOT NULL REFERENCES operators(id),
  decided_by   uuid REFERENCES operators(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz,
  CHECK (status <> 'approved' OR decided_by <> proposed_by)
);

CREATE UNIQUE INDEX dispute_resolutions_open_uq ON dispute_resolutions (order_id) WHERE status = 'proposed';

-- Why an account is restricted, shown to staff.
ALTER TABLE users ADD COLUMN status_reason text;

CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_type, actor_id, id DESC);
