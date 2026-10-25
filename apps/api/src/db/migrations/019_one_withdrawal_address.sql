-- Withdrawal addresses move to the account page and work like receiving addresses: one per coin,
-- on a network the member picks. Withdrawals can only go out on the network custody supports for
-- the coin (`assets.network`), so existing addresses get that network.
ALTER TABLE withdrawal_addresses ADD COLUMN network text;
UPDATE withdrawal_addresses w SET network = a.network FROM assets a WHERE a.code = w.asset;
ALTER TABLE withdrawal_addresses ALTER COLUMN network SET NOT NULL;

-- Members with several addresses for a coin keep the one they last withdrew to, or the newest one
-- if they never withdrew to any. Withdrawals already requested keep their own copy of the address.
CREATE TEMP TABLE withdrawal_address_merge ON COMMIT DROP AS
WITH ranked AS (
  SELECT w.id, w.user_id, w.asset,
         row_number() OVER (
           PARTITION BY w.user_id, w.asset
           ORDER BY (SELECT max(x.created_at) FROM withdrawals x WHERE x.address_id = w.id) DESC NULLS LAST,
                    w.created_at DESC, w.id DESC
         ) AS rank
  FROM withdrawal_addresses w
  WHERE w.status = 'active'
)
SELECT dropped.id AS dropped_id, kept.id AS kept_id
FROM ranked dropped
JOIN ranked kept ON kept.user_id = dropped.user_id AND kept.asset = dropped.asset AND kept.rank = 1
WHERE dropped.rank > 1;

UPDATE withdrawal_addresses SET status = 'removed', removed_at = now()
FROM withdrawal_address_merge m
WHERE withdrawal_addresses.id = m.dropped_id;

INSERT INTO audit_logs (actor_type, actor_id, action, target_type, target_id, before, after)
SELECT 'system', NULL, 'withdrawal_address.remove', 'withdrawal_address', m.dropped_id,
       jsonb_build_object('status', 'active'),
       jsonb_build_object('status', 'removed', 'reason', 'single_address', 'keptId', m.kept_id)
FROM withdrawal_address_merge m;

DROP INDEX withdrawal_addresses_active_uq;
CREATE UNIQUE INDEX withdrawal_addresses_one_active_idx ON withdrawal_addresses (user_id, asset) WHERE status = 'active';
