-- Shared expenses (Sprint 3/4): one row per bill, plus one share per roommate who owes part of it.
-- Used by GET/POST/DELETE /conversations/:inviteCode/expenses in backend/routes.ts and the Expenses tab.
-- All money is whole cents, so amounts add up exactly.

CREATE TABLE expenses (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    -- Who paid the bill. Only they can delete it. If they delete their account the expense goes too.
    paid_by      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        text NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
    amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 1 AND 99999999),
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expenses_by_household ON expenses (household_id, created_at DESC);

CREATE TABLE expense_splits (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    expense_id   uuid NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 0 AND 99999999),
    -- The payer's own share starts out paid.
    is_paid      boolean NOT NULL DEFAULT false,
    UNIQUE (expense_id, user_id)
);
CREATE INDEX expense_splits_by_user ON expense_splits (user_id);
