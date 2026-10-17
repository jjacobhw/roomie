BEGIN;
SELECT pg_temp.expect_error($$INSERT INTO posts (household_id, author_id, body) VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', repeat('x', 0))$$, 'post body length 0');
SELECT pg_temp.expect_error($$INSERT INTO posts (household_id, author_id, body) VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', repeat('x', 2001))$$, 'post body length 2001');

DELETE FROM posts WHERE household_id = '10000000-0000-0000-0000-000000000001';
INSERT INTO posts (household_id, author_id, body, created_at) VALUES
('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'newer first', now()),
('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'newer tie winner', now()),
('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'older higher id', now() - interval '1 minute');
DO $$ BEGIN
  IF (SELECT body FROM posts WHERE household_id = '10000000-0000-0000-0000-000000000001' ORDER BY created_at DESC, id DESC LIMIT 1) IS DISTINCT FROM 'newer tie winner' THEN
    RAISE EXCEPTION 'FAIL: newest post and ID tie ordering';
  END IF;
END $$;
INSERT INTO posts (household_id, author_id, body) VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'x'), ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', repeat('x', 2000));

ROLLBACK;
