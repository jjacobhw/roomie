-- declare assertion function
CREATE FUNCTION pg_temp.expect_error(statement text, label text)
RETURNS void LANGUAGE plpgsql AS $$

-- try invalid sql and catch constraint failure
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN integrity_constraint_violation THEN
    RETURN;
  END;
  -- fail if invalid sql was accepted
  RAISE EXCEPTION 'FAIL: %', label;
END;
$$;

-- asserts expected constraint failures