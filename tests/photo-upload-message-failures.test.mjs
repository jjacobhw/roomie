// US-3-T-17: failure handling when a message with photos is sent (POST /messages/:inviteCode):
// one attachment that cannot be signed must not break the message, and a dead database connection
// must not hide the original error or go back into the pool.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import test, { after } from 'node:test';

import { INVITE_CODE, JPEG_BYTES, PDF_BYTES, PNG_BYTES, users, withUploadApi } from './upload_test_helpers.mjs';
// Loaded after the helper registers its .ts resolver and sets the S3 env vars.
const { registerRoutes } = await import('../backend/routes.ts');
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const express = require('express');

// ---- Unsignable attachment ------------------------------------------------------------------------

// encodeURIComponent throws on a lone surrogate, and a non-image's download URL is signed with the
// file name in it, so this name makes presignDownload fail for that one file only.
const UNSIGNABLE_NAME = '\ud800-receipt.pdf';

test('US-3-T-17 a message is still sent when one attachment cannot be signed', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  await withUploadApi(async (api) => {
    const good = await api.upload({ fileName: 'groceries.png', contentType: 'image/png', bytes: PNG_BYTES });
    const bad = await api.upload({ fileName: UNSIGNABLE_NAME, contentType: 'application/pdf', bytes: PDF_BYTES });

    const sent = await api.send({ messageText: 'Costco run', attachmentIds: [good.id, bad.id] });

    assert.equal(sent.status, 201);
    assert.equal(sent.body.message.messageText, 'Costco run');
    assert.ok(api.state.posts.length === 1, 'the message should have been saved');
    assert.ok(logged.mock.callCount() >= 1, 'the signing failure should be logged');
  });
});

test('US-3-T-17 the message lists only the attachments that could be signed, in the order sent', async (t) => {
  t.mock.method(console, 'error', () => {});
  await withUploadApi(async (api) => {
    const first = await api.upload({ fileName: 'a-receipt.png', contentType: 'image/png', bytes: PNG_BYTES });
    const bad = await api.upload({ fileName: UNSIGNABLE_NAME, contentType: 'application/pdf', bytes: PDF_BYTES });
    const last = await api.upload({ fileName: 'z-receipt.jpg', contentType: 'image/jpeg', bytes: JPEG_BYTES });

    const sent = await api.send({ messageText: '', attachmentIds: [first.id, bad.id, last.id] });

    assert.equal(sent.status, 201);
    assert.deepEqual(sent.body.message.attachments.map((a) => a.id), [first.id, last.id]);
    for (const attachment of sent.body.message.attachments) {
      assert.ok(new URL(attachment.url).searchParams.get('X-Amz-Signature'), 'kept attachments carry a signed URL');
    }
  });
});

// ---- Dead database connection ---------------------------------------------------------------------

// A pg client that fails on the message INSERT, like a dropped connection, and optionally fails on
// ROLLBACK too. Like pg-pool, a second release() of the same client throws.
function brokenPool({ rollbackFails }) {
  const calls = { releases: [], queries: [] };
  const insertError = new Error('connection terminated unexpectedly');
  const rollbackError = new Error('Client has encountered a connection error and is not queryable');
  const client = {
    async query(sql) {
      const text = String(sql).trim();
      calls.queries.push(text.split(/\s+/)[0]);
      if (/^INSERT INTO posts/i.test(text)) throw insertError;
      if (/^ROLLBACK$/i.test(text) && rollbackFails) throw rollbackError;
      return { rows: [], rowCount: 0 };
    },
    release(arg) {
      if (calls.releases.length > 0) throw new Error('Release called on client which has already been released to the pool.');
      calls.releases.push(arg);
    },
  };
  const pool = {
    async query(sql) {
      if (/FROM user_sessions/i.test(sql)) return { rows: [users.uploader], rowCount: 1 };
      if (/AS "exists"/.test(sql)) return { rows: [{ exists: true, isMember: true }], rowCount: 1 };
      throw new Error(`Unexpected query in test: ${sql}`);
    },
    async connect() { return client; },
  };
  return { pool, calls, insertError, rollbackError };
}

async function sendThrough(pool) {
  const errors = [];
  const app = express();
  app.use(express.json());
  registerRoutes(app, pool);
  app.use((error, _request, response, _next) => {
    errors.push(error);
    response.status(500).json({ error: 'server error' });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/messages/${INVITE_CODE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-session' },
      body: JSON.stringify({ messageText: 'photo of the receipt' }),
    });
    return { status: response.status, errors };
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

test('US-3-T-17 a failed ROLLBACK does not hide the original error', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const { pool, insertError } = brokenPool({ rollbackFails: true });

  const result = await sendThrough(pool);

  assert.equal(result.status, 500);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0], insertError, 'Express should receive the original error');
  assert.ok(
    logged.mock.calls.some((call) => String(call.arguments[0]).includes('ROLLBACK failed')),
    'the ROLLBACK failure should be logged'
  );
});

test('US-3-T-17 a connection whose ROLLBACK failed is released once, flagged to be discarded', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { pool, calls, insertError } = brokenPool({ rollbackFails: true });

  const result = await sendThrough(pool);

  assert.deepEqual(calls.releases, [true], 'release(true) exactly once');
  assert.equal(result.errors[0], insertError);
});

test('US-3-T-17 a connection whose ROLLBACK succeeded is released once, back to the pool', async () => {
  const { pool, calls, insertError } = brokenPool({ rollbackFails: false });

  const result = await sendThrough(pool);

  assert.equal(result.errors[0], insertError);
  assert.equal(calls.queries.at(-1), 'ROLLBACK');
  assert.deepEqual(calls.releases, [undefined], 'release() exactly once, without the discard flag');
});
