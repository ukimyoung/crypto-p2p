-- Public name shown to other members, e.g. as the advertiser on the market. Unlike the legal
-- name it is chosen by the member and can be changed. Unique regardless of letter case.
-- Members who joined earlier get a generated one they can change on their account page.
ALTER TABLE users ADD COLUMN nickname text;
UPDATE users SET nickname = 'user_' || substr(replace(id::text, '-', ''), 1, 8);
ALTER TABLE users ALTER COLUMN nickname SET DEFAULT 'user_' || substr(md5(random()::text), 1, 8);
ALTER TABLE users ALTER COLUMN nickname SET NOT NULL;
CREATE UNIQUE INDEX users_nickname_key ON users (lower(nickname));
