BEGIN;
SELECT pg_temp.expect_error($$INSERT INTO attachments (household_id, uploader_id, object_key, file_name, content_type, size_bytes) VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'k0', 'a.png', 'image/png', 0)$$, 'attachment size 0');
SELECT pg_temp.expect_error($$INSERT INTO attachments (household_id, uploader_id, object_key, file_name, content_type, size_bytes) VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'k0', '', 'image/png', 10)$$, 'attachment empty file name');
SELECT pg_temp.expect_error($$INSERT INTO attachments (household_id, uploader_id, object_key, file_name, content_type, size_bytes, status) VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'k0', 'a.png', 'image/png', 10, 'done')$$, 'attachment invalid status');
SELECT pg_temp.expect_error($$INSERT INTO attachments (household_id, uploader_id, object_key, file_name, content_type, size_bytes, status) VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'k0', 'a.png', 'image/png', 10, 'complete')$$, 'complete without completed_at');

INSERT INTO attachments (id, household_id, uploader_id, object_key, file_name, content_type, size_bytes)
VALUES ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'attachments/1', 'a.png', 'image/png', 10);
SELECT pg_temp.expect_error($$INSERT INTO attachments (household_id, uploader_id, object_key, file_name, content_type, size_bytes) VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'attachments/1', 'b.png', 'image/png', 10)$$, 'duplicate object key');
DO $$ BEGIN
  IF (SELECT status FROM attachments WHERE id = '20000000-0000-0000-0000-000000000001') IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'FAIL: attachment default status';
  END IF;
END $$;
UPDATE attachments SET status = 'complete', completed_at = now() WHERE id = '20000000-0000-0000-0000-000000000001';

-- An attachment hangs off a message and goes away with it.
INSERT INTO posts (id, household_id, author_id, body) OVERRIDING SYSTEM VALUE
VALUES (900, '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '');
UPDATE attachments SET post_id = 900 WHERE id = '20000000-0000-0000-0000-000000000001';
DELETE FROM posts WHERE id = 900;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM attachments) THEN
    RAISE EXCEPTION 'FAIL: attachment removed with its post';
  END IF;
END $$;

INSERT INTO attachments (id, household_id, uploader_id, object_key, file_name, content_type, size_bytes)
VALUES ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'attachments/1', 'a.png', 'image/png', 10);
DELETE FROM households WHERE id = '10000000-0000-0000-0000-000000000001';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM attachments) THEN
    RAISE EXCEPTION 'FAIL: attachment cascade';
  END IF;
END $$;
ROLLBACK;
