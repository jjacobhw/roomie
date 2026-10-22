/*
  Roomie households: create, join, read and send messages.

  NEW FILE, added so the frontend's messaging screens can talk to a real server.

  Why this exists next to texting.ts: the queries in texting.ts (createConversation,
  joinConversation, sendMessage, ...) use tables and columns that aren't in
  database/migrations/001_init.sql (a `conversations` table, `users(name, password)`), so they
  can't run against the real database. These functions do the same jobs against the actual
  schema: users, households, household_members and posts.
    - A "conversation" in texting.ts is a household here (invite_code is the join code).
    - A "message" is a row in `posts`.
    - texting.ts is untouched; its functions are simply not used by the server.

  Rules enforced here (the frontend relies on them):
    - one household per user (also backed by the one_household_per_user index)
    - invite codes: 6 characters from A-Z/2-9 (no 0/O/1/I), compared case-insensitively
    - messages: trimmed, 1 to 2000 characters (the CHECK on posts.body), members only
    - 3-second cooldown per sender, kept in memory (resets if the server restarts)

  Users are looked up by display_name, since there's no login yet (Sprint 1 hardcodes names).
  Expected failures throw HttpError and server.ts turns them into the right status code.
 */
import { randomInt } from 'node:crypto';
import type { Pool } from 'pg';

// Thrown for expected failures; server.ts turns it into an HTTP response.
export class HttpError extends Error {
    status: number;
    retryAfterMs?: number;

    constructor(status: number, message: string, retryAfterMs?: number) {
        super(message);
        this.name = 'HttpError';
        this.status = status;
        this.retryAfterMs = retryAfterMs;
    }
}

export interface HouseholdMessage {
    id: string;
    username: string;
    messageText: string;
    timestamp: string; // ISO 8601
}

export const MESSAGE_COOLDOWN_MS = 3000;   // Sprint 1: one message per sender every 3 seconds
export const MAX_MESSAGE_LENGTH = 2000;    // matches the CHECK on posts.body
const INVITE_CODE_LENGTH = 6;
// No 0/O/1/I so codes are easy to read aloud and type.
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TEMPORARY_HOUSEHOLD_NAME = 'House chat';  // until households can be named

const PG_UNIQUE_VIOLATION = '23505';

// When each user last sent a message. In memory is fine: it only needs to outlive 3 seconds.
const lastSentAt = new Map<string, number>();

function generateInviteCode(): string {
    let code = '';
    for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
        code += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
    }
    return code;
}

function isUniqueViolation(error: unknown, constraint?: string): boolean {
    const e = error as { code?: string; constraint?: string };
    return e?.code === PG_UNIQUE_VIOLATION && (constraint === undefined || e.constraint === constraint);
}

// Display names aren't unique in the schema; the oldest account with that name wins.
async function findUserId(pool: Pool, username: string): Promise<string> {
    const result = await pool.query<{ id: string }>(
        'SELECT id FROM users WHERE display_name = $1 ORDER BY created_at, id LIMIT 1',
        [username]
    );
    if (result.rows.length === 0) {
        throw new HttpError(404, 'User not found');
    }
    return result.rows[0].id;
}

// Codes are compared case-insensitively, so "abc234" finds "ABC234".
async function findHouseholdId(pool: Pool, inviteCode: string): Promise<string> {
    const result = await pool.query<{ id: string }>(
        'SELECT id FROM households WHERE upper(invite_code) = upper($1)',
        [inviteCode]
    );
    if (result.rows.length === 0) {
        throw new HttpError(404, `No household with code ${inviteCode}`);
    }
    return result.rows[0].id;
}

async function householdOf(pool: Pool, userId: string): Promise<string | null> {
    const result = await pool.query<{ household_id: string }>(
        'SELECT household_id FROM household_members WHERE user_id = $1',
        [userId]
    );
    return result.rows[0]?.household_id ?? null;
}

/**
 * Create a household owned by the user and return its invite code.
 * Fails with 409 if the user is already in a household (one household per user).
 */
export async function createHousehold(pool: Pool, username: string): Promise<string> {
    const userId = await findUserId(pool, username);
    if ((await householdOf(pool, userId)) !== null) {
        throw new HttpError(409, `${username} is already in a household`);
    }

    // Retry if the random code happens to collide with an existing one.
    for (let attempt = 0; attempt < 10; attempt++) {
        const inviteCode = generateInviteCode();
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const household = await client.query<{ id: string }>(
                'INSERT INTO households (name, invite_code, created_by) VALUES ($1, $2, $3) RETURNING id',
                [TEMPORARY_HOUSEHOLD_NAME, inviteCode, userId]
            );
            await client.query(
                "INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'owner')",
                [household.rows[0].id, userId]
            );
            await client.query('COMMIT');
            return inviteCode;
        } catch (error) {
            await client.query('ROLLBACK');
            if (isUniqueViolation(error, 'one_household_per_user')) {
                // Two requests for the same user raced; the other one won.
                throw new HttpError(409, `${username} is already in a household`);
            }
            if (isUniqueViolation(error)) {
                continue;   // invite code collision: try another one
            }
            throw error;
        } finally {
            client.release();
        }
    }
    throw new Error('Could not generate a unique invite code');
}

/**
 * Add the user to the household with this invite code.
 * Joining the household you are already in is fine; joining a second one is a 409.
 */
export async function joinHousehold(pool: Pool, username: string, inviteCode: string): Promise<void> {
    const userId = await findUserId(pool, username);
    const householdId = await findHouseholdId(pool, inviteCode);

    const current = await householdOf(pool, userId);
    if (current === householdId) return;
    if (current !== null) {
        throw new HttpError(409, `${username} is already in a household`);
    }

    try {
        await pool.query(
            "INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'member')",
            [householdId, userId]
        );
    } catch (error) {
        if (isUniqueViolation(error)) {
            throw new HttpError(409, `${username} is already in a household`);
        }
        throw error;
    }
}

/**
 * All messages in the household, oldest first.
 */
export async function listMessages(pool: Pool, inviteCode: string): Promise<HouseholdMessage[]> {
    const householdId = await findHouseholdId(pool, inviteCode);
    const result = await pool.query<HouseholdMessage>(
        `SELECT p.id::text AS id,
                u.display_name AS username,
                p.body AS "messageText",
                to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS timestamp
         FROM posts p
         JOIN users u ON u.id = p.author_id
         WHERE p.household_id = $1
         ORDER BY p.created_at ASC, p.id ASC`,
        [householdId]
    );
    return result.rows;
}

/**
 * Save a message from a household member, enforcing the per-sender cooldown.
 */
export async function sendHouseholdMessage(
    pool: Pool,
    username: string,
    inviteCode: string,
    messageText: string
): Promise<HouseholdMessage> {
    const userId = await findUserId(pool, username);
    const householdId = await findHouseholdId(pool, inviteCode);

    if ((await householdOf(pool, userId)) !== householdId) {
        throw new HttpError(403, `${username} is not in this household`);
    }

    const body = messageText.trim();
    if (!body) {
        throw new HttpError(400, 'Message is empty');
    }
    if (body.length > MAX_MESSAGE_LENGTH) {
        throw new HttpError(400, `Message is too long (max ${MAX_MESSAGE_LENGTH} characters)`);
    }

    const now = Date.now();
    const waitMs = MESSAGE_COOLDOWN_MS - (now - (lastSentAt.get(userId) ?? 0));
    if (waitMs > 0) {
        throw new HttpError(429, 'Slow down a little', waitMs);
    }
    // Claim the slot before the insert so two quick requests can't both pass.
    lastSentAt.set(userId, now);

    try {
        const result = await pool.query<{ id: string; created_at: Date }>(
            'INSERT INTO posts (household_id, author_id, body) VALUES ($1, $2, $3) RETURNING id::text AS id, created_at',
            [householdId, userId, body]
        );
        return {
            id: result.rows[0].id,
            username,
            messageText: body,
            timestamp: result.rows[0].created_at.toISOString(),
        };
    } catch (error) {
        lastSentAt.delete(userId);   // a failed save shouldn't cost the user their turn
        throw error;
    }
}
