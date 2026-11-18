// Test helpers for the attachment upload tests (US-3-T-3).
//
// Receipts are uploaded in three steps (see backend/uploads.ts):
//   1. POST /conversations/:inviteCode/attachments   -> a 'pending' row and a presigned PUT URL
//   2. PUT the bytes to that URL                       -> goes straight to object storage
//   3. POST /attachments/:id/complete                 -> the server checks storage, marks it 'complete'
//
// To exercise all three for real, this file runs:
//   - the real backend routes, against a fake pg pool that keeps users, posts and attachments in memory
//     (the fake answers by matching the SQL the routes send; an unknown query throws), and
//   - a tiny fake S3 server on localhost. The backend's real AWS SDK signs URLs for it and calls
//     HeadObject on it, so the presigned URLs the tests PUT to are the ones the app would get.
// No database, bucket or network access is needed.
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createRequire, register } from 'node:module';
import { after } from 'node:test';

// The backend's own imports leave off ".ts" (tsc and tsx allow that, plain Node doesn't).
// This hook adds the extension so `node --experimental-strip-types --test` can load them.
register(
  'data:text/javascript,' + encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      try {
        return await next(specifier, context);
      } catch (error) {
        const fromTs = context.parentURL && context.parentURL.endsWith('.ts');
        if (fromTs && /^\\.{1,2}\\//.test(specifier) && !/\\.[a-z]+$/i.test(specifier)) {
          return next(specifier + '.ts', context);
        }
        throw error;
      }
    }
  `)
);

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const express = require('express');

export const INVITE_CODE = 'BEACH1';
export const BUCKET = 'roomie-test';
export const MAX_BYTES = 10 * 1024 * 1024;

export const users = {
  uploader: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', username: 'olivia' },
  roommate: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', username: 'max' },
  outsider: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', username: 'otto' },
};
const HOUSEHOLD_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const members = new Set([users.uploader.id, users.roommate.id]);

// ---- Sample files ----------------------------------------------------------------------------

// A real 1x1 PNG, standing in for a photo of a receipt.
export const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
// Starts with the JPEG magic bytes; storage doesn't decode images, so this is enough.
export const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('receipt photo'), Buffer.from([0xff, 0xd9])]);
export const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% Costco receipt: total $86.40\ntrailer << /Root 1 0 R >>\n%%EOF\n'
);
export const TEXT_BYTES = Buffer.from('Utilities for October\nPG&E: $96.30\nWater: $41.10\nSplit 2 ways: $68.70 each\n');

// ---- Shared state, reset before each test -----------------------------------------------------

const state = {
  signedIn: users.uploader,
  attachments: [], // { id, householdId, uploaderId, objectKey, fileName, contentType, sizeBytes, status, createdAt, completedAt, postId }
  posts: [], // { id, authorId, body }
  objects: new Map(), // fake S3: object key -> { bytes, contentType }
  storageFailure: { put: false, head: false },
  nextPostId: 1,
};

function resetState(signedIn) {
  state.signedIn = signedIn;
  state.attachments = [];
  state.posts = [];
  state.objects = new Map();
  state.storageFailure = { put: false, head: false };
  state.nextPostId = 1;
}

// ---- Fake S3 ----------------------------------------------------------------------------------
// Real S3 rejects a presigned PUT whose Content-Type or Content-Length differ from the signed
// values (backend/storage.ts signs both). The fake does the same by comparing against the
// attachment row that the URL was issued for.

function keyFromPath(pathname) {
  const prefix = `/${BUCKET}/`;
  return pathname.startsWith(prefix) ? decodeURIComponent(pathname.slice(prefix.length)) : null;
}

function s3Error(response, status, code) {
  response.writeHead(status, { 'Content-Type': 'application/xml' });
  response.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`);
}

const storageServer = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://storage.test');
  const key = keyFromPath(url.pathname);
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  if (key === null) return s3Error(response, 404, 'NoSuchBucket');

  if (request.method === 'PUT') {
    if (state.storageFailure.put) return s3Error(response, 500, 'InternalError');
    if (!url.searchParams.get('X-Amz-Signature')) return s3Error(response, 403, 'AccessDenied');
    const row = state.attachments.find((a) => a.objectKey === key);
    if (
      !row
      || request.headers['content-type'] !== row.contentType
      || Number(request.headers['content-length']) !== row.sizeBytes
      || body.length !== row.sizeBytes
    ) {
      return s3Error(response, 403, 'SignatureDoesNotMatch');
    }
    state.objects.set(key, { bytes: body, contentType: row.contentType });
    response.writeHead(200, { ETag: '"fake-etag"' });
    return response.end();
  }

  if (request.method === 'HEAD') {
    if (state.storageFailure.head) {
      response.writeHead(500);
      return response.end();
    }
    const object = state.objects.get(key);
    if (!object) {
      response.writeHead(404);
      return response.end();
    }
    response.writeHead(200, {
      'Content-Length': String(object.bytes.length),
      'Content-Type': object.contentType,
      ETag: '"fake-etag"',
    });
    return response.end();
  }

  if (request.method === 'GET') {
    const object = state.objects.get(key);
    if (!object || !url.searchParams.get('X-Amz-Signature')) return s3Error(response, 404, 'NoSuchKey');
    const headers = { 'Content-Type': object.contentType, 'Content-Length': String(object.bytes.length) };
    const disposition = url.searchParams.get('response-content-disposition');
    if (disposition) headers['Content-Disposition'] = disposition;
    response.writeHead(200, headers);
    return response.end(object.bytes);
  }

  return s3Error(response, 405, 'MethodNotAllowed');
});
storageServer.listen(0, '127.0.0.1');
await once(storageServer, 'listening');

// The backend builds its S3 client from these the first time it needs one, so set them first.
process.env.S3_BUCKET = BUCKET;
process.env.S3_REGION = 'us-east-1';
process.env.S3_ENDPOINT = `http://127.0.0.1:${storageServer.address().port}`;
process.env.S3_ACCESS_KEY_ID = 'test-access-key';
process.env.S3_SECRET_ACCESS_KEY = 'test-secret-key';

const { registerRoutes } = await import('../backend/routes.ts');

// ---- Fake pg pool -----------------------------------------------------------------------------

const ROW = (a) => ({
  id: a.id,
  fileName: a.fileName,
  contentType: a.contentType,
  sizeBytes: String(a.sizeBytes), // pg returns bigint as a string
  status: a.status,
  createdAt: a.createdAt,
  completedAt: a.completedAt,
  objectKey: a.objectKey,
  uploaderId: a.uploaderId,
});

// Writes made inside BEGIN ... COMMIT are held here and only applied on COMMIT, so a ROLLBACK
// (for example when an attachment can't be claimed) leaves the store untouched, like Postgres.
let pendingWrites = null;
function write(apply) {
  if (pendingWrites) pendingWrites.push(apply);
  else apply();
}

async function query(sql, params = []) {
  const text = sql.trim();

  if (/FROM user_sessions/i.test(text)) {
    return state.signedIn ? { rows: [state.signedIn], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (/^BEGIN$/i.test(text)) {
    pendingWrites = [];
    return { rows: [], rowCount: 0 };
  }
  if (/^COMMIT$/i.test(text)) {
    for (const apply of pendingWrites ?? []) apply();
    pendingWrites = null;
    return { rows: [], rowCount: 0 };
  }
  if (/^ROLLBACK$/i.test(text)) {
    pendingWrites = null;
    return { rows: [], rowCount: 0 };
  }
  if (/pg_advisory_xact_lock/.test(text)) return { rows: [], rowCount: 0 };
  if (/AS "retryAfterMs"/.test(text)) return { rows: [], rowCount: 0 }; // no recent message, no cooldown

  if (/AS "exists"/.test(text)) {
    const [inviteCode, userId] = params;
    const exists = inviteCode === INVITE_CODE;
    return { rows: [{ exists, isMember: exists && members.has(userId) }], rowCount: 1 };
  }
  if (/^SELECT id FROM households WHERE invite_code/i.test(text)) {
    return params[0] === INVITE_CODE ? { rows: [{ id: HOUSEHOLD_ID }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  // Step 1: POST /conversations/:inviteCode/attachments
  if (/^INSERT INTO attachments/i.test(text)) {
    const [inviteCode, id, uploaderId, objectKey, fileName, contentType, sizeBytes] = params;
    if (inviteCode !== INVITE_CODE) return { rows: [], rowCount: 0 };
    state.attachments.push({
      id,
      householdId: HOUSEHOLD_ID,
      uploaderId,
      objectKey,
      fileName,
      contentType,
      sizeBytes: Number(sizeBytes),
      status: 'pending',
      createdAt: new Date(),
      completedAt: null,
      postId: null,
    });
    return { rows: [], rowCount: 1 };
  }

  // Step 3: POST /attachments/:id/complete flips pending -> complete (and only that).
  if (/^UPDATE attachments\s+SET status = 'complete'/i.test(text)) {
    const row = state.attachments.find((a) => a.id === params[0] && a.status === 'pending');
    if (row) {
      row.status = 'complete';
      row.completedAt = new Date();
    }
    return { rows: [], rowCount: row ? 1 : 0 };
  }

  // GET /attachments/:id: complete files, for members of the attachment's household only.
  if (/FROM attachments a\s+JOIN household_members hm/i.test(text)) {
    const [id, userId] = params;
    const row = state.attachments.find((a) => a.id === id && a.status === 'complete');
    return row && members.has(userId) ? { rows: [ROW(row)], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  // The complete route reads the row before and after updating it.
  if (/FROM attachments a\s+WHERE a\.id = \$1/i.test(text)) {
    const row = state.attachments.find((a) => a.id === params[0]);
    return row ? { rows: [ROW(row)], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  // POST /messages/:inviteCode
  if (/^INSERT INTO posts/i.test(text)) {
    const [inviteCode, userId, body] = params;
    if (inviteCode !== INVITE_CODE || !members.has(userId)) return { rows: [], rowCount: 0 };
    const post = { id: state.nextPostId++, authorId: userId, body };
    write(() => state.posts.push(post));
    return { rows: [{ id: String(post.id), messageText: body, timestamp: new Date() }], rowCount: 1 };
  }

  // Sending a message claims finished uploads: own, same household, complete, not sent before.
  if (/^UPDATE attachments a\s+SET post_id/i.test(text)) {
    const [postId, ids, uploaderId] = params;
    const claimable = state.attachments.filter(
      (a) => ids.includes(a.id)
        && a.uploaderId === uploaderId
        && a.householdId === HOUSEHOLD_ID
        && a.status === 'complete'
        && a.postId === null
    );
    write(() => claimable.forEach((a) => { a.postId = Number(postId); }));
    const rows = claimable.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      contentType: a.contentType,
      sizeBytes: String(a.sizeBytes),
      objectKey: a.objectKey,
    }));
    return { rows, rowCount: rows.length };
  }

  throw new Error(`Unexpected query in test: ${text}`);
}
const pool = { query, async connect() { return { query, release() {} }; } };

const app = express();
app.use(express.json());
registerRoutes(app, pool);
const apiServer = app.listen(0, '127.0.0.1');
await once(apiServer, 'listening');
export const API_URL = `http://127.0.0.1:${apiServer.address().port}`;

// The app's real upload client (frontend/src/services/httpApi.ts) reads its server address
// from EXPO_PUBLIC_API_URL when it is loaded, so tests that use it must import it after this.
process.env.EXPO_PUBLIC_API_URL = API_URL;

// httpApi.ts imports types without `import type`, which Node's built-in type stripping can't load,
// so it goes through tsx (already a backend dev dependency). Call this after the helper has loaded.
export async function loadAppUploadClient() {
  const { tsImport } = await import(require.resolve('tsx/esm/api'));
  return tsImport('../frontend/src/services/httpApi.ts', import.meta.url);
}

after(async () => {
  for (const server of [apiServer, storageServer]) {
    server.closeAllConnections();
    server.close();
  }
});

// ---- Test API ---------------------------------------------------------------------------------

async function call(method, path, body) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-session' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

// scenario.signedIn: the user making requests, or null for an invalid session.
export async function withUploadApi(run, scenario = {}) {
  resetState(scenario.signedIn === undefined ? users.uploader : scenario.signedIn);

  const api = {
    state,
    signInAs(user) { state.signedIn = user; },
    failStorage(step) { state.storageFailure[step] = true; },
    // Put an object in storage without the presigned URL, e.g. to simulate a truncated upload.
    putObjectDirectly(attachmentId, bytes, contentType = 'application/octet-stream') {
      state.objects.set(`attachments/${attachmentId}`, { bytes, contentType });
    },
    attachment: (id) => state.attachments.find((a) => a.id === id),

    // Step 1
    requestUpload: (body, inviteCode = INVITE_CODE) => call('POST', `/conversations/${inviteCode}/attachments`, body),
    // Step 2: exactly what the app does, sending the headers the server returned.
    async putFile(slot, bytes, headers = slot.uploadHeaders) {
      const response = await fetch(slot.uploadUrl, { method: slot.uploadMethod, headers, body: bytes });
      return response.status;
    },
    // Step 3
    complete: (attachmentId) => call('POST', `/attachments/${attachmentId}/complete`),
    download: (attachmentId) => call('GET', `/attachments/${attachmentId}`),
    send: (body, inviteCode = INVITE_CODE) => call('POST', `/messages/${inviteCode}`, body),

    // All three steps; returns the confirmed attachment from step 3.
    async upload({ fileName, contentType, bytes }) {
      const slot = await api.requestUpload({ fileName, contentType, sizeBytes: bytes.length });
      if (slot.status !== 201) throw new Error(`upload slot failed: ${slot.status} ${JSON.stringify(slot.body)}`);
      const putStatus = await api.putFile(slot.body, bytes);
      if (putStatus !== 200) throw new Error(`storage PUT failed: ${putStatus}`);
      const done = await api.complete(slot.body.attachmentId);
      if (done.status !== 200) throw new Error(`complete failed: ${done.status} ${JSON.stringify(done.body)}`);
      return done.body.attachment;
    },
  };

  await run(api);
}

// Downloads from a presigned URL (as a roommate's app would) and returns the bytes and headers.
export async function fetchSigned(url) {
  const response = await fetch(url);
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    disposition: response.headers.get('content-disposition'),
    bytes: Buffer.from(await response.arrayBuffer()),
  };
}
