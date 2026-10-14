-- Fake data for local development only. Safe to re-run.

INSERT INTO users (id, firebase_uid, display_name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'seed-alice', 'Alice'),
  ('00000000-0000-0000-0000-000000000002', 'seed-bob',   'Bob'),
  ('00000000-0000-0000-0000-000000000003', 'seed-carol', 'Carol')  -- not in any household
ON CONFLICT (firebase_uid) DO NOTHING;

INSERT INTO households (id, name, invite_code, created_by) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Seed House', 'a1b2c3',
   '00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO household_members (household_id, user_id, role) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'member')
ON CONFLICT DO NOTHING;

-- posts has no natural unique key, so only seed it when the board is empty.
INSERT INTO posts (household_id, author_id, body, created_at)
SELECT 'aaaaaaaa-0000-0000-0000-000000000001', v.author_id, v.body, now() - v.age
FROM (VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid, 'Welcome to Seed House!', interval '10 minutes'),
  ('00000000-0000-0000-0000-000000000002'::uuid, 'Who took my oat milk',   interval '5 minutes'),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'Not me',                 interval '1 minute')
) AS v(author_id, body, age)
WHERE NOT EXISTS (
  SELECT 1 FROM posts WHERE household_id = 'aaaaaaaa-0000-0000-0000-000000000001'
);