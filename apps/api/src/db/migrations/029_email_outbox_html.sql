-- Emails can carry an HTML version next to the plain text (the ad agreement confirmation does).
-- Kept as sent, like the plain text, so the record shows exactly what the member received.
ALTER TABLE email_outbox ADD COLUMN html text;
