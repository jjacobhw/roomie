// Push notifications through Expo's push service (https://docs.expo.dev/push-notifications/sending-notifications/).
// Phones register an Expo push token with POST /push-tokens; the chore (and later expense) routes
// call notifyUsers / notifyHousehold, which look up those tokens and hand the message to Expo.
// Sending never blocks or fails the request that caused it: errors are only logged.
import type { Express } from 'express';
import type { Pool } from 'pg';
import { authenticated, isRecord } from './routes.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH_SIZE = 100; // Expo accepts at most 100 messages per request
const TOKEN_PATTERN = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/;

export interface PushMessage {
  title: string;
  body: string;
  // Extra info the app gets when the notification is tapped, e.g. { type: 'chore', listId }.
  data?: Record<string, unknown>;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

export function isExpoPushToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

// Send one message to every phone of the given users. Safe to call without awaiting.
export async function notifyUsers(pool: Pool, userIds: string[], message: PushMessage): Promise<void> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;
  try {
    const result = await pool.query<{ token: string }>(
      'SELECT token FROM push_tokens WHERE user_id = ANY($1::uuid[])',
      [ids]
    );
    await sendToTokens(pool, result.rows.map((row) => row.token), message);
  } catch (error) {
    console.error('Sending push notification failed:', error);
  }
}

// Send one message to everyone in a household except the person who caused it.
export async function notifyHousehold(
  pool: Pool,
  householdId: string,
  exceptUserId: string,
  message: PushMessage
): Promise<void> {
  try {
    const members = await pool.query<{ userId: string }>(
      `SELECT user_id AS "userId" FROM household_members
       WHERE household_id = $1 AND user_id <> $2`,
      [householdId, exceptUserId]
    );
    await notifyUsers(pool, members.rows.map((row) => row.userId), message);
  } catch (error) {
    console.error('Sending push notification failed:', error);
  }
}

async function sendToTokens(pool: Pool, tokens: string[], message: PushMessage): Promise<void> {
  for (let start = 0; start < tokens.length; start += EXPO_BATCH_SIZE) {
    const batch = tokens.slice(start, start + EXPO_BATCH_SIZE);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    // Only needed if "Enhanced push security" is turned on for the project at expo.dev.
    if (process.env.EXPO_ACCESS_TOKEN) {
      headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
    }

    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(batch.map((to) => ({
        to,
        title: message.title,
        body: message.body,
        data: message.data ?? {},
        sound: 'default',
        channelId: 'default',
      }))),
    });
    if (!response.ok) {
      console.error(`Expo push service answered ${response.status}: ${await response.text()}`);
      continue;
    }

    // Expo returns one ticket per message, in order. Forget tokens for uninstalled apps.
    const payload: unknown = await response.json();
    const tickets = isRecord(payload) && Array.isArray(payload.data) ? (payload.data as ExpoTicket[]) : [];
    const deadTokens = batch.filter((_token, index) => (
      tickets[index]?.status === 'error' && tickets[index]?.details?.error === 'DeviceNotRegistered'
    ));
    for (const ticket of tickets) {
      if (ticket?.status === 'error' && ticket.details?.error !== 'DeviceNotRegistered') {
        console.error('Expo rejected a push notification:', ticket.message ?? ticket.details?.error);
      }
    }
    if (deadTokens.length > 0) {
      await pool.query('DELETE FROM push_tokens WHERE token = ANY($1::text[])', [deadTokens]);
    }
  }
}

export function registerNotificationRoutes(app: Express, pool: Pool): void {
  // The app calls this after sign in, once the user allows notifications.
  app.post('/push-tokens', authenticated(pool, async (request, response) => {
    const body: unknown = request.body;
    const token = isRecord(body) ? body.token : undefined;
    const platform = isRecord(body) ? body.platform : undefined;
    if (!isExpoPushToken(token)) {
      response.status(400).json({ error: 'token must be an Expo push token.' });
      return;
    }
    if (platform !== 'ios' && platform !== 'android') {
      response.status(400).json({ error: 'platform must be ios or android.' });
      return;
    }

    // If someone else signed in on this phone before, the token moves to the new user.
    await pool.query(
      `INSERT INTO push_tokens (token, user_id, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE
       SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = now()`,
      [token, request.authUser.id, platform]
    );
    response.status(204).end();
  }));

  // The app calls this on log out so the phone stops getting this user's notifications.
  app.delete('/push-tokens', authenticated(pool, async (request, response) => {
    const body: unknown = request.body;
    const token = isRecord(body) ? body.token : undefined;
    if (!isExpoPushToken(token)) {
      response.status(400).json({ error: 'token must be an Expo push token.' });
      return;
    }
    await pool.query(
      'DELETE FROM push_tokens WHERE token = $1 AND user_id = $2',
      [token, request.authUser.id]
    );
    response.status(204).end();
  }));
}
