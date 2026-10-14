-- pg_temp.expect_error(sql, label): passes if `sql` is rejected by a constraint,
-- raises 'FAIL: <label>' if the database accepts it.
CREATE FUNCTION pg_temp.expect_error(sql text, label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION
    WHEN integrity_constraint_violation THEN
      rejected := true;
  END;

  IF NOT rejected THEN
    RAISE EXCEPTION 'FAIL: % (statement was accepted)', label;
  END IF;
END $$;