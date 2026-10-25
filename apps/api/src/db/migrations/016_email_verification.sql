-- Signup completes only when the member clicks the link emailed to them (PRD AUTH-1).
-- Until then the details wait here, so an unconfirmed signup holds no email, phone number
-- or nickname in `users`. Submitting the form again for the same email replaces the request.
CREATE TABLE signup_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL UNIQUE,
  password_hash  text NOT NULL,
  phone          text NOT NULL,
  phone_country  text NOT NULL,
  nickname       text NOT NULL,
  locale         text NOT NULL DEFAULT 'ko' CHECK (locale IN ('ko', 'en')),
  token_hash     bytea NOT NULL UNIQUE,           -- sha256 of the token in the link; the token itself is never stored
  sent_at        timestamptz NOT NULL,
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- When the member confirmed their email. Null for members who joined before signup asked for it;
-- they keep using their accounts as before.
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
