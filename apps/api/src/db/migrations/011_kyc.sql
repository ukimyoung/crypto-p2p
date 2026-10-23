-- Admin page, step 5: identity verification through Sumsub (KYC-1 to KYC-6).
-- One Sumsub level only, so KYC is either not done (0) or done (1).

UPDATE users SET kyc_level = 1 WHERE kyc_level > 1;
ALTER TABLE users ADD CONSTRAINT users_kyc_level_check CHECK (kyc_level IN (0, 1));

DELETE FROM withdrawal_daily_limits WHERE kyc_level > 1;
ALTER TABLE withdrawal_daily_limits ADD CONSTRAINT withdrawal_daily_limits_level_check CHECK (kyc_level IN (0, 1));

UPDATE ads SET min_taker_kyc_level = 1 WHERE min_taker_kyc_level > 1;
ALTER TABLE ads ADD CONSTRAINT ads_min_taker_kyc_level_check CHECK (min_taker_kyc_level IN (0, 1));

-- The member's Sumsub applicant and its latest review. ID images stay in Sumsub.
CREATE TABLE kyc_applicants (
  user_id            uuid PRIMARY KEY REFERENCES users (id),
  applicant_id       text NOT NULL UNIQUE,
  level_name         text,
  -- init, pending, prechecked, queued, onHold, completed
  review_status      text NOT NULL DEFAULT 'init',
  review_answer      text CHECK (review_answer IN ('GREEN', 'RED')),
  reject_type        text CHECK (reject_type IN ('RETRY', 'FINAL')),
  reject_labels      text[] NOT NULL DEFAULT '{}',
  -- What Sumsub tells the member, and its note for us.
  moderation_comment text,
  client_comment     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Every webhook delivery that passed the signature check. A repeat of the same body is ignored.
CREATE TABLE sumsub_webhooks (
  id               bigserial PRIMARY KEY,
  body_sha256      text NOT NULL UNIQUE,
  type             text NOT NULL,
  applicant_id     text,
  external_user_id text,
  payload          jsonb NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sumsub_webhooks_applicant_idx ON sumsub_webhooks (applicant_id, id DESC);
