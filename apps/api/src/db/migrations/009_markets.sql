-- Admin page, step 3: coin and market status, member list.

-- Coin status (MKT-1). ads_paused: no new ads. withdrawals_paused: no new withdrawals.
-- delisted: no new ads, orders or withdrawals.
ALTER TABLE assets ADD COLUMN status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'ads_paused', 'withdrawals_paused', 'delisted'));

-- Markets are coin × fiat pairs (MKT-2). paused: no new ads or orders, open orders carry on.
-- closed: the same, and the market is hidden.
CREATE TABLE markets (
  asset       text NOT NULL REFERENCES assets(code),
  fiat        text NOT NULL REFERENCES fiat_currencies(code),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paused', 'closed')),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES operators(id),
  PRIMARY KEY (asset, fiat)
);

INSERT INTO markets (asset, fiat) SELECT a.code, f.code FROM assets a CROSS JOIN fiat_currencies f;

-- Member grid sorts and filters (USR-1, USR-3).
CREATE INDEX users_created_idx ON users (created_at DESC);
CREATE INDEX orders_maker_status_idx ON orders (maker_id, status);
CREATE INDEX ads_maker_idx ON ads (maker_id, created_at DESC);
CREATE INDEX orders_created_idx ON orders (created_at DESC);
