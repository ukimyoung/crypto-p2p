-- Signup no longer waits for an emailed confirmation link: the account is created and
-- logged in right away. Signups still waiting for their link become accounts now, so those
-- members can log in with the password they chose. A request whose email, phone number or
-- nickname was taken in the meantime is dropped; that person can sign up again.
INSERT INTO users (email, password_hash, phone, phone_country, nickname, locale, first_name, last_name, created_at)
SELECT email, password_hash, phone, phone_country, nickname, locale, first_name, last_name, created_at
FROM signup_requests
ORDER BY created_at
ON CONFLICT DO NOTHING;

DROP TABLE signup_requests;
