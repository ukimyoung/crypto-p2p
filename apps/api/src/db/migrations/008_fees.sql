-- Admin page, step 2: maker fee as a % of the price, charged in fiat and billed per day or month.
-- The fee is added to the maker's price, so the buyer pays it with the trade. Coins are no
-- longer taken as a fee: the seller locks and the buyer receives the same amount.

-- Fee rates in 0.01% units (25 = 0.25%). A row with no market is the default rate.
-- A market row with a null rate goes back to the default. Rows are never edited:
-- each change adds a row with the time it takes effect.
CREATE TABLE fee_rates (
  id              bigserial PRIMARY KEY,
  asset           text REFERENCES assets(code),
  fiat            text REFERENCES fiat_currencies(code),
  rate_bp         int CHECK (rate_bp BETWEEN 0 AND 1000),
  effective_from  timestamptz NOT NULL,
  reason          text NOT NULL,
  created_by      uuid REFERENCES operators(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((asset IS NULL) = (fiat IS NULL)),
  CHECK (asset IS NOT NULL OR rate_bp IS NOT NULL)
);

CREATE INDEX fee_rates_market_idx ON fee_rates (asset, fiat, effective_from DESC);

INSERT INTO fee_rates (asset, fiat, rate_bp, effective_from, reason)
VALUES (NULL, NULL, 0, '2000-01-01', '최초 요율 (기존 MAKER_FEE_BPS=0)');

-- Operations settings edited from the admin page.
CREATE TABLE ops_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES operators(id)
);

INSERT INTO ops_settings (key, value) VALUES
  ('billing.cycle', '"monthly"'),
  ('billing.due_days', '7');

-- Fee invoices: one per maker, fiat and billing period.
CREATE TABLE fee_invoices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maker_id            uuid NOT NULL REFERENCES users(id),
  fiat                text NOT NULL REFERENCES fiat_currencies(code),
  period_start        timestamptz NOT NULL,
  period_end          timestamptz NOT NULL,
  total_minor         numeric(78, 0) NOT NULL CHECK (total_minor > 0),
  paid_minor          numeric(78, 0) NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
  status              text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'partially_paid', 'paid', 'overdue')),
  -- End of the due date. Unpaid after this, the maker's ads are hidden.
  due_at              timestamptz NOT NULL,
  issued_at           timestamptz NOT NULL DEFAULT now(),
  paid_at             timestamptz,
  reminded_before_at  timestamptz,
  reminded_due_at     timestamptz,
  CHECK (paid_minor <= total_minor)
);

CREATE INDEX fee_invoices_maker_idx ON fee_invoices (maker_id, status);
CREATE INDEX fee_invoices_status_due_idx ON fee_invoices (status, due_at);

-- Payments are confirmed outside the system and recorded by a reviewer.
CREATE TABLE fee_payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   uuid NOT NULL REFERENCES fee_invoices(id),
  amount_minor numeric(78, 0) NOT NULL CHECK (amount_minor > 0),
  paid_at      timestamptz NOT NULL,
  memo         text NOT NULL DEFAULT '',
  operator_id  uuid NOT NULL REFERENCES operators(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX fee_payments_invoice_idx ON fee_payments (invoice_id);

-- Orders keep the price the maker entered, the rate and the fiat fee, fixed when the order opens.
-- price_minor becomes the final price (with the fee) and fiat_amount_minor what the buyer pays.
ALTER TABLE orders
  ADD COLUMN base_price_minor numeric(78, 0),
  ADD COLUMN fee_rate_bp int NOT NULL DEFAULT 0,
  ADD COLUMN fee_fiat_minor numeric(78, 0) NOT NULL DEFAULT 0 CHECK (fee_fiat_minor >= 0),
  ADD COLUMN fee_invoice_id uuid REFERENCES fee_invoices(id);

UPDATE orders SET base_price_minor = price_minor;
ALTER TABLE orders ALTER COLUMN base_price_minor SET NOT NULL;

-- Completed orders with a fee that is not billed yet.
CREATE INDEX orders_unbilled_fee_idx ON orders (maker_id, completed_at)
  WHERE status = 'completed' AND fee_fiat_minor > 0 AND fee_invoice_id IS NULL;
