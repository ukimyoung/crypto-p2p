-- In-app notifications and an email outbox (NOTI-1).

ALTER TABLE users ADD COLUMN locale text NOT NULL DEFAULT 'ko' CHECK (locale IN ('ko', 'en'));

-- Written in the same transaction as the event, so a notification exists exactly when the change committed.
CREATE TABLE notifications (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id),
  type        text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);

CREATE INDEX notifications_user_idx ON notifications (user_id, id DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

-- Emails waiting to go out. A worker sends them and retries with backoff.
CREATE TABLE email_outbox (
  id               bigserial PRIMARY KEY,
  notification_id  bigint REFERENCES notifications(id),
  to_address       text NOT NULL,
  subject          text NOT NULL,
  body             text NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts         int NOT NULL DEFAULT 0,
  last_error       text,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz
);

CREATE INDEX email_outbox_pending_idx ON email_outbox (next_attempt_at) WHERE status = 'pending';
