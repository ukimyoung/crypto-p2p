-- Core schema for the P2P MVP: users, double-entry ledger, ads, orders, audit log.
-- Crypto amounts are integers in the asset's smallest unit (satoshi, wei, ...).
-- Fiat amounts are integers in the currency's minor unit (KRW has none, USD has cents).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE assets (
  code      text PRIMARY KEY,
  network   text NOT NULL,
  decimals  int  NOT NULL CHECK (decimals BETWEEN 0 AND 30)
);

INSERT INTO assets (code, network, decimals) VALUES
  ('BTC',  'bitcoin',  8),
  ('ETH',  'ethereum', 18),
  ('USDT', 'ethereum', 6);

CREATE TABLE fiat_currencies (
  code      text PRIMARY KEY,
  decimals  int  NOT NULL CHECK (decimals BETWEEN 0 AND 4)
);

INSERT INTO fiat_currencies (code, decimals) VALUES ('KRW', 0), ('USD', 2);

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text UNIQUE,
  phone       text UNIQUE,
  kyc_level   int  NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trade_suspended', 'withdraw_held', 'closed')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Ledger -------------------------------------------------------------------

-- User accounts: one per (user, asset, kind). System accounts: user_id is null.
CREATE TABLE ledger_accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id),
  asset       text NOT NULL REFERENCES assets(code),
  kind        text NOT NULL CHECK (kind IN (
                'available', 'escrow', 'withdrawal_pending',   -- user balances
                'custody', 'fee_revenue'                        -- system accounts
              )),
  balance     numeric(78, 0) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((user_id IS NULL) = (kind IN ('custody', 'fee_revenue'))),
  -- A user can never hold a negative balance. The custody account mirrors
  -- on-chain holdings and goes negative as users are credited with deposits.
  CHECK (user_id IS NULL OR balance >= 0)
);

CREATE UNIQUE INDEX ledger_accounts_user_uq ON ledger_accounts (user_id, asset, kind) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX ledger_accounts_system_uq ON ledger_accounts (asset, kind) WHERE user_id IS NULL;

CREATE TABLE ledger_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key  text NOT NULL UNIQUE,
  kind             text NOT NULL,
  ref_type         text,
  ref_id           uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entries (
  id              bigserial PRIMARY KEY,
  transaction_id  uuid NOT NULL REFERENCES ledger_transactions(id),
  account_id      uuid NOT NULL REFERENCES ledger_accounts(id),
  amount          numeric(78, 0) NOT NULL CHECK (amount <> 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ledger_entries_account_idx ON ledger_entries (account_id);
CREATE INDEX ledger_entries_transaction_idx ON ledger_entries (transaction_id);

-- Every ledger transaction must balance to zero per asset. Checked at commit
-- so all entries of a transaction can be inserted first.
CREATE FUNCTION ledger_check_balanced() RETURNS trigger AS $$
DECLARE
  unbalanced text;
BEGIN
  SELECT a.asset INTO unbalanced
  FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
  WHERE e.transaction_id = NEW.transaction_id
  GROUP BY a.asset
  HAVING sum(e.amount) <> 0
  LIMIT 1;
  IF unbalanced IS NOT NULL THEN
    RAISE EXCEPTION 'ledger transaction % does not balance for %', NEW.transaction_id, unbalanced;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();

-- Ledger rows and audit rows are append-only.
CREATE FUNCTION reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER ledger_transactions_append_only BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Ads ------------------------------------------------------------------------

CREATE TABLE ads (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maker_id                uuid NOT NULL REFERENCES users(id),
  side                    text NOT NULL CHECK (side IN ('buy', 'sell')),  -- what the maker does
  asset                   text NOT NULL REFERENCES assets(code),
  fiat                    text NOT NULL REFERENCES fiat_currencies(code),
  price_type              text NOT NULL DEFAULT 'fixed' CHECK (price_type IN ('fixed', 'floating')),
  price_minor             numeric(78, 0) NOT NULL CHECK (price_minor > 0),  -- fiat minor units per 1 whole coin
  total_amount            numeric(78, 0) NOT NULL CHECK (total_amount > 0),
  remaining_amount        numeric(78, 0) NOT NULL CHECK (remaining_amount >= 0),
  min_order_fiat_minor    numeric(78, 0) NOT NULL CHECK (min_order_fiat_minor > 0),
  max_order_fiat_minor    numeric(78, 0) NOT NULL,
  payment_window_minutes  int  NOT NULL DEFAULT 15 CHECK (payment_window_minutes BETWEEN 5 AND 180),
  min_taker_kyc_level     int  NOT NULL DEFAULT 1,
  status                  text NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'offline', 'closed')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (max_order_fiat_minor >= min_order_fiat_minor),
  CHECK (remaining_amount <= total_amount)
);

CREATE INDEX ads_market_idx ON ads (asset, fiat, side, status);

-- Orders -----------------------------------------------------------------------

CREATE TABLE orders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id              uuid NOT NULL REFERENCES ads(id),
  maker_id           uuid NOT NULL REFERENCES users(id),
  buyer_id           uuid NOT NULL REFERENCES users(id),
  seller_id          uuid NOT NULL REFERENCES users(id),
  asset              text NOT NULL REFERENCES assets(code),
  fiat               text NOT NULL REFERENCES fiat_currencies(code),
  price_minor        numeric(78, 0) NOT NULL,
  amount             numeric(78, 0) NOT NULL CHECK (amount > 0),   -- coins the buyer receives before fees
  fiat_amount_minor  numeric(78, 0) NOT NULL CHECK (fiat_amount_minor > 0),
  fee_amount         numeric(78, 0) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),  -- charged to the maker
  escrow_amount      numeric(78, 0) NOT NULL CHECK (escrow_amount > 0),          -- locked from the seller
  status             text NOT NULL CHECK (status IN ('pending_payment', 'paid', 'completed', 'cancelled', 'under_review')),
  payment_deadline   timestamptz NOT NULL,
  paid_at            timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  cancel_reason      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (buyer_id <> seller_id)
);

CREATE INDEX orders_status_deadline_idx ON orders (status, payment_deadline);
CREATE INDEX orders_buyer_idx ON orders (buyer_id);
CREATE INDEX orders_seller_idx ON orders (seller_id);

-- Audit log --------------------------------------------------------------------

CREATE TABLE audit_logs (
  id           bigserial PRIMARY KEY,
  actor_type   text NOT NULL CHECK (actor_type IN ('user', 'operator', 'system')),
  actor_id     uuid,
  action       text NOT NULL,
  target_type  text NOT NULL,
  target_id    uuid NOT NULL,
  before       jsonb,
  after        jsonb,
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_target_idx ON audit_logs (target_type, target_id);

CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
