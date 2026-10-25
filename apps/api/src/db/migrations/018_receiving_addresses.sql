-- Crypto addresses a member receives coins at, shown on the account page under the bank account.
-- One per coin, on a network the member picks (USDT, for example, on Ethereum or Tron). Changing
-- it keeps the old row as `removed` so the history stays readable.
CREATE TABLE receiving_addresses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  asset       text NOT NULL REFERENCES assets(code),
  network     text NOT NULL,
  address     text NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  removed_at  timestamptz
);

CREATE UNIQUE INDEX receiving_addresses_one_active_idx ON receiving_addresses (user_id, asset) WHERE status = 'active';
