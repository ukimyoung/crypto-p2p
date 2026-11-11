-- Members agree to the ad terms (광고 등록 서비스 이용 동의) every time they post a sell or buy ad.
-- Kept as evidence for disputes and legal requests, so neither table is ever updated or deleted from.

-- The exact text members were shown, one row per version, side and language.
CREATE TABLE ad_terms (
  hash        text PRIMARY KEY,                -- sha256 of body, hex
  version     text NOT NULL,
  side        text NOT NULL CHECK (side IN ('sell', 'buy')),
  locale      text NOT NULL,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version, side, locale)
);

-- One row per ad: who agreed, to which text, when, and from where.
CREATE TABLE ad_agreements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id),
  ad_id          uuid NOT NULL UNIQUE REFERENCES ads(id),
  side           text NOT NULL CHECK (side IN ('sell', 'buy')),
  terms_version  text NOT NULL,
  terms_hash     text NOT NULL REFERENCES ad_terms(hash),
  locale         text NOT NULL,
  agreed_at      timestamptz NOT NULL DEFAULT now(),
  ip             text,
  user_agent     text
);
CREATE INDEX ad_agreements_user_idx ON ad_agreements (user_id, agreed_at DESC);
