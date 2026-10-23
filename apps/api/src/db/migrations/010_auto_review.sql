-- Admin page, step 4: orders go to operator review on their own when the seller does not
-- release within a set time after the buyer marks them paid (ORD-3, OPR-3).

-- Who sent an order to review, and when. Orders escalated before this migration have no source.
ALTER TABLE orders
  ADD COLUMN review_source text CHECK (review_source IN ('buyer', 'seller', 'system')),
  ADD COLUMN escalated_at timestamptz;

-- Minutes after "paid" before the system sends the order to review.
INSERT INTO ops_settings (key, value) VALUES ('orders.auto_review_minutes', '10');

CREATE INDEX orders_paid_idx ON orders (paid_at) WHERE status = 'paid';
