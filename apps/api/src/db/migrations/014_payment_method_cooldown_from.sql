-- When a payment method's cooldown starts. A new account starts it on registration; changing the
-- registered account carries the old start over, so a changed account can be used right away
-- (or as soon as the original account's cooldown would have ended).
ALTER TABLE payment_methods ADD COLUMN cooldown_from timestamptz;
UPDATE payment_methods SET cooldown_from = created_at;
ALTER TABLE payment_methods ALTER COLUMN cooldown_from SET NOT NULL;
