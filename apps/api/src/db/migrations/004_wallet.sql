-- Withdrawal address whitelist (WAL-2) and withdrawals (WAL-3).

CREATE TABLE withdrawal_addresses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  asset       text NOT NULL REFERENCES assets(code),
  address     text NOT NULL,
  label       text NOT NULL DEFAULT '' CHECK (char_length(label) <= 40),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  removed_at  timestamptz
);

CREATE UNIQUE INDEX withdrawal_addresses_active_uq
  ON withdrawal_addresses (user_id, asset, address) WHERE status = 'active';

CREATE TABLE withdrawals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id),
  asset        text NOT NULL REFERENCES assets(code),
  address_id   uuid NOT NULL REFERENCES withdrawal_addresses(id),
  address      text NOT NULL,                                   -- copied so later edits cannot change it
  amount       numeric(78, 0) NOT NULL CHECK (amount > 0),      -- what arrives on chain
  fee          numeric(78, 0) NOT NULL CHECK (fee >= 0),        -- network fee charged on top
  status       text NOT NULL CHECK (status IN (
                 'requested', 'approved', 'sent', 'confirmed', 'rejected', 'cancelled', 'failed')),
  tx_hash      text,
  reviewed_by  uuid,
  review_note  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX withdrawals_user_idx ON withdrawals (user_id, created_at DESC);
CREATE INDEX withdrawals_status_idx ON withdrawals (status, created_at);
