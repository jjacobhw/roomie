// US-3-T-3: members can upload a photo of a receipt to the house chat so everyone can see how to
// split the cost. These tests cover image uploads end to end: requesting an upload URL, sending
// the bytes to storage, confirming, posting it in a message, and a roommate opening it.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  JPEG_BYTES,
  MAX_BYTES,
  PNG_BYTES,
  fetchSigned,
  users,
  withUploadApi,
} from './upload_test_helpers.mjs';
// Loaded after the helper registers its .ts resolver.
const { checkAttachment, isPreviewableImage, MessagingError } = await import('../frontend/src/types/messaging.ts');

test('US-3-T-3 requesting an image upload returns a pending attachment and a signed PUT URL', async () => {
  await withUploadApi(async (api) => {
    const response = await api.requestUpload({
      fileName: 'trader-joes-receipt.png',
      contentType: 'image/png',
      sizeBytes: PNG_BYTES.length,
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.status, 'pending');
    assert.equal(response.body.uploadMethod, 'PUT');
    assert.deepEqual(response.body.uploadHeaders, { 'Content-Type': 'image/png' });
    assert.equal(response.body.expiresInSeconds, 300);
    const url = new URL(response.body.uploadUrl);
    assert.equal(url.pathname, `/roomie-test/attachments/${response.body.attachmentId}`);
    assert.ok(url.searchParams.get('X-Amz-Signature'), 'upload URL should be presigned');

    const row = api.attachment(response.body.attachmentId);
    assert.equal(row.status, 'pending');
    assert.equal(row.uploaderId, users.uploader.id);
    assert.equal(row.fileName, 'trader-joes-receipt.png');
  });
});

test('US-3-T-3 a PNG receipt photo uploads, is confirmed, and stores the exact bytes', async () => {
  await withUploadApi(async (api) => {
    const attachment = await api.upload({ fileName: 'groceries.png', contentType: 'image/png', bytes: PNG_BYTES });

    assert.equal(attachment.status, 'complete');
    assert.equal(attachment.contentType, 'image/png');
    assert.equal(attachment.sizeBytes, PNG_BYTES.length);
    assert.ok(attachment.completedAt, 'completedAt should be set');
    const stored = api.state.objects.get(`attachments/${attachment.id}`);
    assert.ok(stored.bytes.equals(PNG_BYTES), 'storage should hold the uploaded bytes unchanged');
  });
});

test('US-3-T-3 every supported image type can be uploaded', async () => {
  await withUploadApi(async (api) => {
    for (const contentType of ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic']) {
      const attachment = await api.upload({ fileName: `receipt.${contentType.split('/')[1]}`, contentType, bytes: JPEG_BYTES });
      assert.equal(attachment.status, 'complete', contentType);
      assert.equal(attachment.contentType, contentType);
    }
    assert.equal(api.state.attachments.length, 5);
  });
});

test('US-3-T-3 a receipt photo posted in the chat can be opened by a roommate as an inline image', async () => {
  await withUploadApi(async (api) => {
    const photo = await api.upload({ fileName: 'dinner.jpg', contentType: 'image/jpeg', bytes: JPEG_BYTES });

    const sent = await api.send({ messageText: 'Dinner was $64.20, $21.40 each', attachmentIds: [photo.id] });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.message.messageText, 'Dinner was $64.20, $21.40 each');
    assert.equal(sent.body.message.attachments.length, 1);
    const [inMessage] = sent.body.message.attachments;
    assert.equal(inMessage.id, photo.id);
    assert.equal(inMessage.fileName, 'dinner.jpg');
    assert.equal(inMessage.contentType, 'image/jpeg');
    assert.equal(inMessage.sizeBytes, JPEG_BYTES.length);
    assert.equal(inMessage.objectKey, undefined, 'storage keys must not leak to clients');

    // Pictures are served inline so the chat can draw them.
    const fromMessage = await fetchSigned(inMessage.url);
    assert.equal(fromMessage.status, 200);
    assert.equal(fromMessage.disposition, 'inline');
    assert.ok(fromMessage.bytes.equals(JPEG_BYTES));

    // A roommate can also fetch it on its own.
    api.signInAs(users.roommate);
    const forRoommate = await api.download(photo.id);
    assert.equal(forRoommate.status, 200);
    const file = await fetchSigned(forRoommate.body.downloadUrl);
    assert.equal(file.status, 200);
    assert.equal(file.contentType, 'image/jpeg');
    assert.ok(file.bytes.equals(JPEG_BYTES));
  });
});

test('US-3-T-3 an image-only message (no text) is accepted', async () => {
  await withUploadApi(async (api) => {
    const photo = await api.upload({ fileName: 'receipt.png', contentType: 'image/png', bytes: PNG_BYTES });
    const sent = await api.send({ messageText: '   ', attachmentIds: [photo.id] });

    assert.equal(sent.status, 201);
    assert.equal(sent.body.message.messageText, '');
    assert.equal(sent.body.message.attachments[0].id, photo.id);
    assert.equal(api.attachment(photo.id).postId, 1);
  });
});

test('US-3-T-3 unsupported image formats are rejected with 415 and no attachment is created', async () => {
  await withUploadApi(async (api) => {
    for (const contentType of ['image/bmp', 'image/tiff', 'image/svg+xml']) {
      const response = await api.requestUpload({ fileName: 'receipt', contentType, sizeBytes: 100 });
      assert.equal(response.status, 415, contentType);
      assert.equal(response.body.error, 'contentType is not allowed.');
      assert.ok(response.body.allowed.includes('image/png'));
    }
    assert.equal(api.state.attachments.length, 0);
  });
});

test('US-3-T-3 images over 10 MB are rejected with 413; exactly 10 MB is allowed', async () => {
  await withUploadApi(async (api) => {
    const tooBig = await api.requestUpload({ fileName: 'huge.jpg', contentType: 'image/jpeg', sizeBytes: MAX_BYTES + 1 });
    assert.equal(tooBig.status, 413);
    assert.equal(tooBig.body.error, `sizeBytes must be a whole number between 1 and ${MAX_BYTES}.`);

    const atLimit = await api.requestUpload({ fileName: 'big.jpg', contentType: 'image/jpeg', sizeBytes: MAX_BYTES });
    assert.equal(atLimit.status, 201);
    assert.equal(api.state.attachments.length, 1);
  });
});

test('US-3-T-3 only signed-in household members can upload images', async () => {
  const body = { fileName: 'receipt.png', contentType: 'image/png', sizeBytes: PNG_BYTES.length };

  await withUploadApi(async (api) => {
    const response = await api.requestUpload(body);
    assert.equal(response.status, 401);
  }, { signedIn: null });

  await withUploadApi(async (api) => {
    const response = await api.requestUpload(body);
    assert.equal(response.status, 403);
    assert.equal(response.body.error, 'User is not a member of this conversation.');
    assert.equal(api.state.attachments.length, 0);
  }, { signedIn: users.outsider });

  await withUploadApi(async (api) => {
    const response = await api.requestUpload(body, 'NOPE99');
    assert.equal(response.status, 404);
    assert.equal(response.body.error, 'Conversation not found.');
  });
});

test('US-3-T-3 the app checks image type and size before uploading, and knows which images to preview', () => {
  const photo = { uri: 'file:///receipt.jpg', name: 'receipt.jpg', mimeType: 'image/jpeg', sizeBytes: 2048 };
  assert.doesNotThrow(() => checkAttachment(photo));
  assert.doesNotThrow(() => checkAttachment({ ...photo, mimeType: 'IMAGE/PNG' }));

  assert.throws(
    () => checkAttachment({ ...photo, mimeType: 'image/bmp' }),
    (error) => error instanceof MessagingError && error.code === 'UNSUPPORTED_FILE'
  );
  assert.throws(
    () => checkAttachment({ ...photo, sizeBytes: MAX_BYTES + 1 }),
    (error) => error instanceof MessagingError && error.code === 'FILE_TOO_LARGE'
  );

  for (const type of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) assert.equal(isPreviewableImage(type), true);
  assert.equal(isPreviewableImage('image/heic'), false, 'HEIC uploads but shows as a file chip');
  assert.equal(isPreviewableImage('application/pdf'), false);
});
