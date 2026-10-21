BEGIN;
SELECT pg_temp.expect_error($$INSERT INTO household_members (household_id, user_id, role) VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'admin')$$, 'invalid role');

INSERT INTO households (id, name, invite_code, created_by) VALUES ('10000000-0000-0000-0000-000000000002', 'Second', 'SECOND', '00000000-0000-0000-0000-000000000001');
SELECT pg_temp.expect_error($$INSERT INTO household_members (household_id, user_id) VALUES ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001')$$, 'second household');
DELETE FROM households WHERE id = '10000000-0000-0000-0000-000000000001';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM household_members WHERE household_id = '10000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'FAIL: membership cascade';
  END IF;
  IF EXISTS (SELECT 1 FROM posts WHERE household_id = '10000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'FAIL: post cascade';
  END IF;
END $$;

ROLLBACK;
