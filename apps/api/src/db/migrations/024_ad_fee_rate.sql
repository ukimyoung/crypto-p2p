-- Each ad keeps the maker fee rate in force when it was posted, so a later rate change
-- only applies to new ads. The market shows this rate and orders on the ad charge it.
ALTER TABLE ads ADD COLUMN fee_rate_bp int CHECK (fee_rate_bp BETWEEN 0 AND 1000);

-- Existing ads get the rate that was in force when they were posted: the market's own
-- rate, or the default when the market had none or went back to the default.
UPDATE ads a
SET fee_rate_bp = COALESCE(
  (SELECT r.rate_bp FROM fee_rates r
   WHERE r.asset = a.asset AND r.fiat = a.fiat AND r.effective_from <= a.created_at
   ORDER BY r.effective_from DESC, r.id DESC LIMIT 1),
  (SELECT r.rate_bp FROM fee_rates r
   WHERE r.asset IS NULL AND r.effective_from <= a.created_at
   ORDER BY r.effective_from DESC, r.id DESC LIMIT 1),
  0
);

ALTER TABLE ads ALTER COLUMN fee_rate_bp SET NOT NULL;
