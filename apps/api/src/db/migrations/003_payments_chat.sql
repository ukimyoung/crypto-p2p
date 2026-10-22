-- Payment methods (PAY-1) and order chat.

-- Real name confirmed by KYC (AUTH-2). Bank account holders must match it.
ALTER TABLE users ADD COLUMN legal_name text;

CREATE TABLE payment_methods (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id),
  type                text NOT NULL DEFAULT 'bank_transfer' CHECK (type IN ('bank_transfer')),
  fiat                text NOT NULL REFERENCES fiat_currencies(code),
  bank_code           text NOT NULL,
  account_holder      text NOT NULL,
  account_number_enc  text NOT NULL,           -- AES-256-GCM, see SecretBox
  account_last4       text NOT NULL,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  removed_at          timestamptz
);

CREATE INDEX payment_methods_user_idx ON payment_methods (user_id);

-- Where the buyer sends fiat: the seller's account, fixed when the order opens.
ALTER TABLE ads ADD COLUMN payment_method_id uuid REFERENCES payment_methods(id);
ALTER TABLE orders ADD COLUMN seller_payment_method_id uuid REFERENCES payment_methods(id);

CREATE TABLE order_messages (
  id          bigserial PRIMARY KEY,
  order_id    uuid NOT NULL REFERENCES orders(id),
  sender_id   uuid NOT NULL REFERENCES users(id),
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX order_messages_order_idx ON order_messages (order_id, id);

-- Chat is evidence in disputes, so it is append-only too.
CREATE TRIGGER order_messages_append_only BEFORE UPDATE OR DELETE ON order_messages
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
