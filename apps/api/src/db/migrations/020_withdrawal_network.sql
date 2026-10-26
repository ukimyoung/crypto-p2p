-- USDT can now be withdrawn on Tron (TRC-20) and BNB Smart Chain (BEP-20) as well as Ethereum, so
-- each withdrawal records the network custody must send it on, copied from its address.
ALTER TABLE withdrawals ADD COLUMN network text;
UPDATE withdrawals w SET network = a.network FROM withdrawal_addresses a WHERE a.id = w.address_id;
ALTER TABLE withdrawals ALTER COLUMN network SET NOT NULL;
