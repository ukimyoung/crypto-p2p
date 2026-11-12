-- Reference price (시세) an operator sets by hand on the admin page, in fiat minor units per
-- 1 whole coin. Rows are never edited: each change adds a row, and the latest row is the
-- price now. Nothing uses it for trading yet; it is the stand-in for a price feed.
CREATE TABLE reference_prices (
  id          bigserial PRIMARY KEY,
  asset       text NOT NULL REFERENCES assets(code),
  fiat        text NOT NULL REFERENCES fiat_currencies(code),
  price_minor numeric(78, 0) NOT NULL CHECK (price_minor > 0),
  reason      text NOT NULL,
  created_by  uuid REFERENCES operators(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reference_prices_market_idx ON reference_prices (asset, fiat, id DESC);
