-- Name the member types at signup, as first and last name (PRD AUTH-1). It is what the member
-- calls themselves; the verified name from the ID document stays in `legal_name`, which the bank
-- account holder check uses. Members who joined earlier have no name here.
ALTER TABLE users ADD COLUMN first_name text, ADD COLUMN last_name text;
-- Signup requests made before this change have no name either.
ALTER TABLE signup_requests ADD COLUMN first_name text, ADD COLUMN last_name text;
