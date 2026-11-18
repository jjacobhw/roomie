-- A message can be posted as an alert: the app pins the latest one at the top of the board.
ALTER TABLE posts
    ADD COLUMN is_alert boolean NOT NULL DEFAULT false;

CREATE INDEX posts_alerts_by_household ON posts (household_id, created_at DESC) WHERE is_alert;

-- Who has acknowledged an alert ("Seen by" names). One row per person per alert.
CREATE TABLE alert_seen (
    post_id bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seen_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, user_id)
);
