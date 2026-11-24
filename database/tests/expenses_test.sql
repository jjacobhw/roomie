BEGIN;
-- Sam's $30 groceries in the demo household, split between Sam and Alex
INSERT INTO expenses (id, household_id, paid_by, title, amount_cents) VALUES
('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000002', 'Groceries', 3000);
INSERT INTO expense_splits (expense_id, user_id, amount_cents, is_paid) VALUES
('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 1500, true),
('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 1500, false);

SELECT pg_temp.expect_error($$INSERT INTO expenses (household_id, paid_by, title, amount_cents) VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '', 100)$$, 'title length 0');
SELECT pg_temp.expect_error($$INSERT INTO expenses (household_id, paid_by, title, amount_cents) VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', repeat('x', 101), 100)$$, 'title length 101');
SELECT pg_temp.expect_error($$INSERT INTO expenses (household_id, paid_by, title, amount_cents) VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'x', 0)$$, 'zero amount');
SELECT pg_temp.expect_error($$INSERT INTO expense_splits (expense_id, user_id, amount_cents) VALUES ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', -1)$$, 'negative share');
SELECT pg_temp.expect_error($$INSERT INTO expense_splits (expense_id, user_id, amount_cents) VALUES ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 5)$$, 'two shares for one person');

-- deleting an expense removes its shares
DELETE FROM expenses WHERE id = '30000000-0000-0000-0000-000000000001';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM expense_splits WHERE expense_id = '30000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'FAIL: deleting an expense should delete its shares';
  END IF;
END $$;
ROLLBACK;
