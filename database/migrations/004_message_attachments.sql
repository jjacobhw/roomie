-- A file belongs to at most one message. It stays NULL while the file is only uploaded
-- (and for uploads that are never sent); the API sets it when the message is posted.
ALTER TABLE attachments
    ADD COLUMN post_id bigint REFERENCES posts(id) ON DELETE CASCADE;

CREATE INDEX attachments_by_post ON attachments (post_id) WHERE post_id IS NOT NULL;

-- A message may now be only attachments, so its text can be empty. The API still
-- requires text or at least one attachment.
ALTER TABLE posts
    DROP CONSTRAINT posts_body_check,
    ADD CONSTRAINT posts_body_check CHECK (length(body) BETWEEN 0 AND 2000);
