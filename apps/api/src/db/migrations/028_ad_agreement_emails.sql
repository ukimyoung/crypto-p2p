-- After a member posts an ad, the terms they agreed to are emailed to them (광고 등록 동의 확인 메일).
-- The email_outbox row already keeps the recipient, subject, full body, queue time and send time;
-- these columns tie it to the agreement and keep the id Resend gave the message, for evidence.
ALTER TABLE email_outbox ADD COLUMN ad_agreement_id uuid REFERENCES ad_agreements(id);
ALTER TABLE email_outbox ADD COLUMN provider_message_id text;
CREATE INDEX email_outbox_ad_agreement_idx ON email_outbox (ad_agreement_id) WHERE ad_agreement_id IS NOT NULL;
