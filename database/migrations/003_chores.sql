-- Chores (Sprint 2): each household has chore lists, and each list has items that can be checked off.
-- A list can belong to one roommate ("Sam's chores") or to the whole house (assigned_to NULL).

CREATE TABLE chore_lists (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    title        text NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
    -- Whose chores these are. If that roommate deletes their account the list stays, unassigned.
    assigned_to  uuid REFERENCES users(id) ON DELETE SET NULL,
    created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chore_lists_by_household ON chore_lists (household_id, created_at);

CREATE TABLE chore_items (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    list_id    uuid NOT NULL REFERENCES chore_lists(id) ON DELETE CASCADE,
    body       text NOT NULL CHECK (length(body) BETWEEN 1 AND 200),
    is_done    boolean NOT NULL DEFAULT false,
    -- Who checked it off and when; both are NULL while the chore is open.
    done_by    uuid REFERENCES users(id) ON DELETE SET NULL,
    done_at    timestamptz,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (is_done OR (done_by IS NULL AND done_at IS NULL))
);
CREATE INDEX chore_items_by_list ON chore_items (list_id, created_at);
