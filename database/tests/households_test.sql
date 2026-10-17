BEGIN;
SELECT pg_temp.expect_error($$INSERT INTO households (name, invite_code, created_by) VALUES ('Duplicate', 'DEMO01', '00000000-0000-0000-0000-000000000001')$$, 'duplicate invite code');
SELECT pg_temp.expect_error($$INSERT INTO households (name, invite_code, created_by) VALUES ('Missing', 'MISSING', 'ffffffff-ffff-ffff-ffff-ffffffffffff')$$, 'missing creator');
SELECT pg_temp.expect_error($$INSERT INTO households (name, invite_code, created_by) VALUES (repeat('x', 0), 'LENGTH', '00000000-0000-0000-0000-000000000001')$$, 'household name length 0');
SELECT pg_temp.expect_error($$INSERT INTO households (name, invite_code, created_by) VALUES (repeat('x', 81), 'LENGTH', '00000000-0000-0000-0000-000000000001')$$, 'household name length 81');
INSERT INTO households (name, invite_code, created_by) VALUES ('x', 'MIN', '00000000-0000-0000-0000-000000000001'), (repeat('x', 80), 'MAX', '00000000-0000-0000-0000-000000000001');
ROLLBACK;
