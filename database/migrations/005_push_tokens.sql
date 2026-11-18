-- Push notifications: each phone that allows notifications registers an Expo push token.
-- One user can have several phones; a token belongs to whoever signed in on that phone last.

CREATE TABLE push_tokens (
    token      text PRIMARY KEY CHECK (length(token) BETWEEN 1 AND 255),
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform   text NOT NULL CHECK (platform IN ('ios', 'android')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_tokens_by_user ON push_tokens (user_id);
