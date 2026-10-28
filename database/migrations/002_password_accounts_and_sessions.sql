ALTER TABLE users
    ALTER COLUMN firebase_uid DROP NOT NULL,
    ADD COLUMN password_hash text,
    ADD CONSTRAINT users_auth_identity CHECK (
        firebase_uid IS NOT NULL OR password_hash IS NOT NULL
    );

CREATE UNIQUE INDEX users_display_name_ci ON users (lower(display_name));

CREATE TABLE user_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text UNIQUE NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX user_sessions_by_expiry ON user_sessions (expires_at);
