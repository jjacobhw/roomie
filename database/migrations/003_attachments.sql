-- File uploads go straight to object storage through a presigned URL.
-- The row is created as 'pending' when the URL is issued and flipped to
-- 'complete' once the server confirms the object exists with the expected size.
CREATE TABLE attachments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    uploader_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    object_key text UNIQUE NOT NULL,
    file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
    content_type text NOT NULL,
    size_bytes bigint NOT NULL CHECK (size_bytes > 0),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete')),
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CHECK ((status = 'complete') = (completed_at IS NOT NULL))
);

CREATE INDEX attachments_by_household ON attachments (household_id, created_at DESC);
