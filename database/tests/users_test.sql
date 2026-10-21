BEGIN;
SELECT pg_temp.expect_error($$INSERT INTO users (firebase_uid, display_name) VALUES ('local-user-1', 'Duplicate')$$, 'duplicate Firebase UID');
SELECT pg_temp.expect_error($$INSERT INTO users (firebase_uid, display_name) VALUES ('test-null', NULL)$$, 'null display name');
SELECT pg_temp.expect_error($$INSERT INTO users (firebase_uid, display_name) VALUES ('test-length', repeat('x', 0))$$, 'display name length 0');
SELECT pg_temp.expect_error($$INSERT INTO users (firebase_uid, display_name) VALUES ('test-length', repeat('x', 51))$$, 'display name length 51');
INSERT INTO users (firebase_uid, display_name) VALUES ('test-min', 'x'), ('test-max', repeat('x', 50));
ROLLBACK;
