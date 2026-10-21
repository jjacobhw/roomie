-- Fixed identities make the fixtures safe to load repeatedly.

-- created 3 demo users
INSERT INTO users (id, firebase_uid, display_name) VALUES
('00000000-0000-0000-0000-000000000001', 'local-user-1', 'Alex'),
('00000000-0000-0000-0000-000000000002', 'local-user-2', 'Sam'),
('00000000-0000-0000-0000-000000000003', 'local-user-3', 'Taylor')
ON CONFLICT (id) DO NOTHING;

-- create a demo household
INSERT INTO households (id, name, invite_code, created_by) VALUES
('10000000-0000-0000-0000-000000000001', 'Demo household', 'DEMO01', '00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- add demo household members
INSERT INTO household_members (household_id, user_id, role) VALUES
('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'owner'),
('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'member')
ON CONFLICT (household_id, user_id) DO NOTHING;

-- insert sample post with different timestamps
INSERT INTO posts (household_id, author_id, body, created_at)
SELECT '10000000-0000-0000-0000-000000000001'::uuid,
       '00000000-0000-0000-0000-000000000001'::uuid, body, now() - age
FROM (VALUES ('Welcome home!', interval '15 minutes'),
             ('Groceries are in the kitchen.', interval '10 minutes'),
             ('House meeting tonight?', interval '5 minutes')) AS demo(body, age)
WHERE NOT EXISTS (SELECT 1 FROM posts WHERE household_id = '10000000-0000-0000-0000-000000000001');

-- adds repeatable demo data
