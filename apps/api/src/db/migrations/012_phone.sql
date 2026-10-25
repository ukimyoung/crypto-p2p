-- Member phone number with its country (PRD AUTH-1). Required at signup from now on;
-- members who joined earlier add it on their account page.
-- `phone` holds the number in E.164 form (+821012345678) and `phone_country` the ISO 3166 country
-- the member picked, since some calling codes (+1, +7) cover more than one country.
ALTER TABLE users ADD COLUMN phone_country text CHECK (phone_country ~ '^[A-Z]{2}$');
