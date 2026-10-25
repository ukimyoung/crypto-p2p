-- One bank account per member for receiving payments (PAY-1). Several accounts confused buyers
-- about where to send money, so a member now keeps a single account and changes it in place.
--
-- Members who registered more than one keep the account their most recent open ad uses, or the
-- newest one if no open ad uses any. The others are removed, and open ads that pointed at them move
-- to the kept account when the currency matches; an online ad that cannot move is taken offline.
-- Orders already opened keep the account they were opened with, so a buyer who already paid is
-- not sent somewhere else.
CREATE TEMP TABLE payment_method_merge ON COMMIT DROP AS
WITH ranked AS (
  SELECT pm.id, pm.user_id,
         row_number() OVER (
           PARTITION BY pm.user_id
           ORDER BY (SELECT max(a.created_at) FROM ads a
                     WHERE a.payment_method_id = pm.id AND a.status <> 'closed') DESC NULLS LAST,
                    pm.created_at DESC, pm.id DESC
         ) AS rank
  FROM payment_methods pm
  WHERE pm.status = 'active'
)
SELECT dropped.id AS dropped_id, kept.id AS kept_id
FROM ranked dropped
JOIN ranked kept ON kept.user_id = dropped.user_id AND kept.rank = 1
WHERE dropped.rank > 1;

UPDATE ads SET payment_method_id = m.kept_id
FROM payment_method_merge m, payment_methods kept
WHERE ads.payment_method_id = m.dropped_id AND kept.id = m.kept_id
  AND ads.status <> 'closed' AND ads.fiat = kept.fiat;

UPDATE ads SET status = 'offline'
FROM payment_method_merge m
WHERE ads.payment_method_id = m.dropped_id AND ads.status = 'online';

UPDATE payment_methods SET status = 'removed', removed_at = now()
FROM payment_method_merge m
WHERE payment_methods.id = m.dropped_id;

INSERT INTO audit_logs (actor_type, actor_id, action, target_type, target_id, before, after)
SELECT 'system', NULL, 'payment_method.remove', 'payment_method', m.dropped_id,
       jsonb_build_object('status', 'active'),
       jsonb_build_object('status', 'removed', 'reason', 'single_account', 'keptId', m.kept_id)
FROM payment_method_merge m;

CREATE UNIQUE INDEX payment_methods_one_active_idx ON payment_methods (user_id) WHERE status = 'active';
