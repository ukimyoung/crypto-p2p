-- Members confirm their phone number with a 6-digit code sent by SMS (내 계정 > 휴대폰 번호).
-- Numbers given at signup, or saved before this, stay unverified until the member confirms them.
ALTER TABLE users ADD COLUMN phone_verified_at timestamptz;

-- One row per code sent. Only the newest unused row for a member can be confirmed.
CREATE TABLE phone_verifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone          text NOT NULL,                  -- E.164
  phone_country  text NOT NULL,
  code_hash      bytea NOT NULL,                 -- sha256 of id + code; the code itself is never stored
  attempts       int NOT NULL DEFAULT 0,         -- wrong codes typed for this row
  sent_at        timestamptz NOT NULL,
  expires_at     timestamptz NOT NULL,
  verified_at    timestamptz
);
CREATE INDEX phone_verifications_user_idx ON phone_verifications (user_id, sent_at DESC);
CREATE INDEX phone_verifications_phone_idx ON phone_verifications (phone, sent_at DESC);
