-- Admin page, step 1: two operator roles, single-operator decisions, withdrawal rules in the database.

-- Roles are now reviewer and admin only. Support staff become reviewers.
UPDATE operators SET role = 'reviewer' WHERE role = 'support';
ALTER TABLE operators DROP CONSTRAINT operators_role_check;
ALTER TABLE operators ADD CONSTRAINT operators_role_check CHECK (role IN ('reviewer', 'admin'));

-- One reviewer decides a dispute alone. Old proposals that never got a second
-- approval are closed so nothing is left waiting.
ALTER TABLE dispute_resolutions DROP CONSTRAINT dispute_resolutions_check;
UPDATE dispute_resolutions SET status = 'declined', decided_at = now() WHERE status = 'proposed';

-- Sensitive actions need a fresh OTP code. A step-up opens a short window on the session.
ALTER TABLE operator_sessions ADD COLUMN step_up_until timestamptz;

-- Withdrawal rules per coin, edited from the admin page. Amounts are in the coin's smallest unit.
-- The first values are the placeholders that used to live in wallet-config.ts.
CREATE TABLE withdrawal_rules (
  asset             text PRIMARY KEY REFERENCES assets(code),
  fee               numeric(78, 0) NOT NULL CHECK (fee >= 0),
  min_amount        numeric(78, 0) NOT NULL CHECK (min_amount > 0),
  -- Requests up to this amount skip operator review. 0 sends everything to review.
  auto_approve_max  numeric(78, 0) NOT NULL CHECK (auto_approve_max >= 0),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES operators(id)
);

-- Rolling 24-hour limit by KYC level. A level with no row cannot withdraw that coin.
CREATE TABLE withdrawal_daily_limits (
  asset        text NOT NULL REFERENCES withdrawal_rules(asset),
  kyc_level    int  NOT NULL CHECK (kyc_level >= 0),
  daily_limit  numeric(78, 0) NOT NULL CHECK (daily_limit > 0),
  PRIMARY KEY (asset, kyc_level)
);

INSERT INTO withdrawal_rules (asset, fee, min_amount, auto_approve_max) VALUES
  ('BTC',  20000,                 50000,                 10000000),
  ('ETH',  2000000000000000,      10000000000000000,     2000000000000000000),
  ('USDT', 5000000,               10000000,              5000000000);

INSERT INTO withdrawal_daily_limits (asset, kyc_level, daily_limit) VALUES
  ('BTC',  1, 100000000),
  ('BTC',  2, 1000000000),
  ('ETH',  1, 20000000000000000000),
  ('ETH',  2, 200000000000000000000),
  ('USDT', 1, 50000000000),
  ('USDT', 2, 500000000000);

-- Settings changes are audited against a key such as a coin code, not only row ids.
ALTER TABLE audit_logs ALTER COLUMN target_id TYPE text;
