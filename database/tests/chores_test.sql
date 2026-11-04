BEGIN;
-- a list in the demo household, assigned to Sam
INSERT INTO chore_lists (id, household_id, title, assigned_to, created_by) VALUES
('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Sam''s chores',
 '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001');

SELECT pg_temp.expect_error($$INSERT INTO chore_lists (household_id, title) VALUES ('10000000-0000-0000-0000-000000000001', '')$$, 'list title length 0');
SELECT pg_temp.expect_error($$INSERT INTO chore_lists (household_id, title) VALUES ('10000000-0000-0000-0000-000000000001', repeat('x', 81))$$, 'list title length 81');
SELECT pg_temp.expect_error($$INSERT INTO chore_items (list_id, body) VALUES ('20000000-0000-0000-0000-000000000001', '')$$, 'item body length 0');
SELECT pg_temp.expect_error($$INSERT INTO chore_items (list_id, body) VALUES ('20000000-0000-0000-0000-000000000001', repeat('x', 201))$$, 'item body length 201');
SELECT pg_temp.expect_error($$INSERT INTO chore_items (list_id, body, is_done, done_at) VALUES ('20000000-0000-0000-0000-000000000001', 'x', false, now())$$, 'open item with done_at');

INSERT INTO chore_items (list_id, body) VALUES ('20000000-0000-0000-0000-000000000001', 'Take out trash');
UPDATE chore_items SET is_done = true, done_by = '00000000-0000-0000-0000-000000000002', done_at = now()
WHERE list_id = '20000000-0000-0000-0000-000000000001';

-- deleting the assignee keeps the list but unassigns it
DELETE FROM users WHERE id = '00000000-0000-0000-0000-000000000002';
DO $$ BEGIN
  IF (SELECT assigned_to FROM chore_lists WHERE id = '20000000-0000-0000-0000-000000000001') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: deleted assignee should leave list unassigned';
  END IF;
END $$;

-- deleting a list removes its items
DELETE FROM chore_lists WHERE id = '20000000-0000-0000-0000-000000000001';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM chore_items WHERE list_id = '20000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'FAIL: deleting a list should delete its items';
  END IF;
END $$;
ROLLBACK;
