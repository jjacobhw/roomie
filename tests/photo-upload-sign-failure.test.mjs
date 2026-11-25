// US-3-T-17: when object storage cannot sign an upload URL, POST /conversations/:inviteCode/attachments
// must answer 502 and must not leave a 'pending' attachments row behind.
import assert from 'node:assert/strict';
import test from 'node:test';

import { PNG_BYTES, withUploadApi } from './upload_test_helpers.mjs';

// The backend builds its S3 client on first use, and this file never makes a successful storage
// call before then. An endpoint that is not a URL makes the SDK fail while signing, which is what
// a misconfigured bucket or endpoint looks like to the route. (Each test file runs in its own process.)
process.env.S3_ENDPOINT = 'not a url';

const receipt = { fileName: 'receipt.png', contentType: 'image/png', sizeBytes: PNG_BYTES.length };

test('US-3-T-17 returns 502 when the upload URL cannot be signed', async (t) => {
  const logged = t.mock.method(console, 'error', () => {}); // the route logs the signing error
  await withUploadApi(async (api) => {
    const response = await api.requestUpload(receipt);

    assert.equal(response.status, 502);
    assert.equal(response.body.error, 'File storage is unavailable. Please try again later.');
    assert.equal(response.body.uploadUrl, undefined, 'no upload URL should be returned');
    assert.ok(logged.mock.callCount() >= 1, 'the signing failure should be logged');
  });
});

test('US-3-T-17 creates no pending attachment row when signing fails', async (t) => {
  t.mock.method(console, 'error', () => {});
  await withUploadApi(async (api) => {
    const response = await api.requestUpload(receipt);

    assert.equal(response.status, 502);
    assert.equal(api.state.attachments.length, 0);
  });
});
