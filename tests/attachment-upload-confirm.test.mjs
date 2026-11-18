// US-3-T-3: an upload only counts once the server has confirmed it. POST /attachments/:id/complete
// checks that storage really holds the file at the declared size before marking it 'complete', and
// only complete files can be downloaded or sent in a message. These tests check that confirmation
// step, plus the app's own upload function (frontend/src/services/httpApi.ts) that relies on it.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PDF_BYTES,
  PNG_BYTES,
  TEXT_BYTES,
  loadAppUploadClient,
  users,
  withUploadApi,
} from './upload_test_helpers.mjs';
// Loaded after the helper starts the test server and sets EXPO_PUBLIC_API_URL.
const { uploadAttachment } = await loadAppUploadClient();

// httpApi.ts is loaded through tsx, so its MessagingError is a separate copy of the class;
// match on the name and code instead of using instanceof.
const isMessagingError = (code, message) => (error) =>
  error.name === 'MessagingError' && error.code === code && (message === undefined || error.message === message);

const receipt = { fileName: 'receipt.png', contentType: 'image/png', sizeBytes: PNG_BYTES.length };

// ---- Backend: the complete endpoint -------------------------------------------------------------

test('US-3-T-3 confirming after the file is in storage marks it complete', async () => {
  await withUploadApi(async (api) => {
    const slot = await api.requestUpload(receipt);
    assert.equal(await api.putFile(slot.body, PNG_BYTES), 200);

    const done = await api.complete(slot.body.attachmentId);

    assert.equal(done.status, 200);
    assert.equal(done.body.attachment.id, slot.body.attachmentId);
    assert.equal(done.body.attachment.status, 'complete');
    assert.equal(done.body.attachment.sizeBytes, PNG_BYTES.length);
    assert.ok(done.body.attachment.completedAt);
    assert.equal(done.body.attachment.objectKey, undefined, 'storage keys must not leak');
    assert.equal(done.body.attachment.uploaderId, undefined, 'uploader ids must not leak');
    assert.equal(api.attachment(slot.body.attachmentId).status, 'complete');
  });
});

test('US-3-T-3 confirming before anything was uploaded returns 409 and leaves it pending', async () => {
  await withUploadApi(async (api) => {
    const slot = await api.requestUpload(receipt);

    const done = await api.complete(slot.body.attachmentId);

    assert.equal(done.status, 409);
    assert.equal(done.body.error, 'The file has not been uploaded yet.');
    assert.equal(api.attachment(slot.body.attachmentId).status, 'pending');
    assert.equal(api.attachment(slot.body.attachmentId).completedAt, null);
  });
});

test('US-3-T-3 confirming a file whose stored size differs from the declared size returns 409', async () => {
  await withUploadApi(async (api) => {
    const slot = await api.requestUpload(receipt);
    // Simulate a truncated upload reaching storage.
    api.putObjectDirectly(slot.body.attachmentId, PNG_BYTES.subarray(0, 10), 'image/png');

    const done = await api.complete(slot.body.attachmentId);

    assert.equal(done.status, 409);
    assert.equal(done.body.error, 'Uploaded file size does not match the size that was declared.');
    assert.equal(api.attachment(slot.body.attachmentId).status, 'pending');
  });
});

test('US-3-T-3 confirming twice is safe and returns the same completed attachment', async () => {
  await withUploadApi(async (api) => {
    const slot = await api.requestUpload(receipt);
    await api.putFile(slot.body, PNG_BYTES);

    const first = await api.complete(slot.body.attachmentId);
    const second = await api.complete(slot.body.attachmentId);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.deepEqual(second.body, first.body);
  });
});

test('US-3-T-3 only the uploader can confirm; others and bad ids get 404', async () => {
  await withUploadApi(async (api) => {
    const slot = await api.requestUpload(receipt);
    await api.putFile(slot.body, PNG_BYTES);

    api.signInAs(users.roommate);
    const byRoommate = await api.complete(slot.body.attachmentId);
    assert.equal(byRoommate.status, 404);
    assert.equal(byRoommate.body.error, 'Attachment not found.');
    assert.equal(api.attachment(slot.body.attachmentId).status, 'pending');

    api.signInAs(users.uploader);
    assert.equal((await api.complete('not-a-uuid')).status, 404);
    assert.equal((await api.complete('00000000-0000-4000-8000-000000000000')).status, 404);
  });

  await withUploadApi(async (api) => {
    const response = await api.complete('00000000-0000-4000-8000-000000000000');
    assert.equal(response.status, 401);
  }, { signedIn: null });
});

test('US-3-T-3 when storage cannot be checked the server returns 502 and keeps the file pending', async (t) => {
  t.mock.method(console, 'error', () => {}); // the route logs the storage error; keep test output clean
  await withUploadApi(async (api) => {
    const slot = await api.requestUpload(receipt);
    await api.putFile(slot.body, PNG_BYTES);
    api.failStorage('head');

    const done = await api.complete(slot.body.attachmentId);

    assert.equal(done.status, 502);
    assert.equal(done.body.error, 'File storage is unavailable. Please try again later.');
    assert.equal(api.attachment(slot.body.attachmentId).status, 'pending');
  });
});

test('US-3-T-3 storage rejects an upload whose Content-Type differs from the signed one', async () => {
  await withUploadApi(async (api) => {
    const slot = await api.requestUpload(receipt);

    const status = await api.putFile(slot.body, PNG_BYTES, { 'Content-Type': 'application/pdf' });

    assert.equal(status, 403);
    assert.equal((await api.complete(slot.body.attachmentId)).status, 409);
  });
});

// ---- Only confirmed files can be used -----------------------------------------------------------

test('US-3-T-3 a pending upload cannot be downloaded or sent, and the failed send creates no message', async () => {
  await withUploadApi(async (api) => {
    const slot = await api.requestUpload(receipt);
    await api.putFile(slot.body, PNG_BYTES); // bytes are in storage, but nobody confirmed them
    const id = slot.body.attachmentId;

    const download = await api.download(id);
    assert.equal(download.status, 404);

    const sent = await api.send({ messageText: 'Pizza $30', attachmentIds: [id] });
    assert.equal(sent.status, 400);
    assert.equal(sent.body.error, 'One or more attachments are missing, unfinished, or already sent.');
    assert.equal(api.state.posts.length, 0, 'the message must be rolled back');
    assert.equal(api.attachment(id).postId, null);
  });
});

test('US-3-T-3 if one of several attachments is unconfirmed, none are attached', async () => {
  await withUploadApi(async (api) => {
    const confirmed = await api.upload({ fileName: 'a.pdf', contentType: 'application/pdf', bytes: PDF_BYTES });
    const pending = await api.requestUpload(receipt);

    const sent = await api.send({ messageText: 'Two receipts', attachmentIds: [confirmed.id, pending.body.attachmentId] });

    assert.equal(sent.status, 400);
    assert.equal(api.state.posts.length, 0);
    assert.equal(api.attachment(confirmed.id).postId, null, 'the confirmed file stays free to send again');
  });
});

test('US-3-T-3 a confirmed upload can be sent once; sending it again is rejected', async () => {
  await withUploadApi(async (api) => {
    const photo = await api.upload({ fileName: 'receipt.png', contentType: 'image/png', bytes: PNG_BYTES });

    const first = await api.send({ messageText: 'Groceries $42.18', attachmentIds: [photo.id] });
    const again = await api.send({ messageText: 'Groceries again', attachmentIds: [photo.id] });

    assert.equal(first.status, 201);
    assert.equal(again.status, 400);
    assert.equal(api.state.posts.length, 1);
  });
});

test('US-3-T-3 a roommate cannot send someone else\'s upload, and outsiders cannot download it', async () => {
  await withUploadApi(async (api) => {
    const photo = await api.upload({ fileName: 'receipt.png', contentType: 'image/png', bytes: PNG_BYTES });

    api.signInAs(users.roommate);
    const sent = await api.send({ messageText: 'mine now', attachmentIds: [photo.id] });
    assert.equal(sent.status, 400);
    assert.equal((await api.download(photo.id)).status, 200, 'roommates can still view it');

    api.signInAs(users.outsider);
    const download = await api.download(photo.id);
    assert.equal(download.status, 404);
    assert.equal(download.body.downloadUrl, undefined);
  });
});

// ---- The app's upload function ------------------------------------------------------------------

function pickedFile(name, mimeType, bytes) {
  // A data: URI stands in for the local file:// URI the picker returns; fetch() reads both.
  return { uri: `data:${mimeType};base64,${bytes.toString('base64')}`, name, mimeType, sizeBytes: bytes.length };
}

test('US-3-T-3 the app\'s uploadAttachment resolves only after the server confirms the upload', async () => {
  await withUploadApi(async (api) => {
    const uploaded = await uploadAttachment('test-session', 'BEACH1', pickedFile('rent-receipt.pdf', 'application/pdf', PDF_BYTES));

    assert.deepEqual(Object.keys(uploaded).sort(), ['contentType', 'fileName', 'id', 'sizeBytes']);
    assert.equal(uploaded.fileName, 'rent-receipt.pdf');
    assert.equal(uploaded.contentType, 'application/pdf');
    assert.equal(uploaded.sizeBytes, PDF_BYTES.length);
    assert.equal(api.attachment(uploaded.id).status, 'complete');
    assert.ok(api.state.objects.get(`attachments/${uploaded.id}`).bytes.equals(PDF_BYTES));

    // The returned id is ready to send.
    const sent = await api.send({ messageText: 'Rent receipt', attachmentIds: [uploaded.id] });
    assert.equal(sent.status, 201);
  });
});

test('US-3-T-3 the app\'s uploadAttachment works for photos and text files too', async () => {
  await withUploadApi(async (api) => {
    const photo = await uploadAttachment('test-session', 'BEACH1', pickedFile('receipt.png', 'image/png', PNG_BYTES));
    const note = await uploadAttachment('test-session', 'BEACH1', pickedFile('split.txt', 'text/plain', TEXT_BYTES));

    assert.equal(api.attachment(photo.id).status, 'complete');
    assert.equal(api.attachment(note.id).status, 'complete');
  });
});

test('US-3-T-3 the app\'s uploadAttachment throws if storage rejects the file, and nothing is confirmed', async () => {
  await withUploadApi(async (api) => {
    api.failStorage('put');

    await assert.rejects(
      uploadAttachment('test-session', 'BEACH1', pickedFile('receipt.png', 'image/png', PNG_BYTES)),
      isMessagingError('SERVER_ERROR', 'The file could not be uploaded')
    );
    assert.equal(api.state.attachments.length, 1);
    assert.equal(api.state.attachments[0].status, 'pending');
  });
});

test('US-3-T-3 the app\'s uploadAttachment surfaces server errors with the right codes', async () => {
  await withUploadApi(async () => {
    await assert.rejects(
      uploadAttachment('test-session', 'BEACH1', pickedFile('receipt.png', 'image/png', PNG_BYTES)),
      isMessagingError('NOT_A_MEMBER')
    );
  }, { signedIn: users.outsider });

  await withUploadApi(async (api) => {
    await assert.rejects(
      uploadAttachment('test-session', 'BEACH1', { ...pickedFile('r.png', 'image/png', PNG_BYTES), mimeType: 'image/bmp' }),
      isMessagingError('UNSUPPORTED_FILE')
    );
    assert.equal(api.state.attachments.length, 0, 'rejected before any request is made');
  });
});
