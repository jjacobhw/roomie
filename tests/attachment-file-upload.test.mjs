// US-3-T-3: besides photos, members can attach receipt files (PDFs and plain-text notes) to the
// house chat so expenses can be split. These tests cover non-image uploads: which files are
// accepted, how names and sizes are validated, and sending files in a message.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_BYTES,
  PDF_BYTES,
  PNG_BYTES,
  TEXT_BYTES,
  fetchSigned,
  users,
  withUploadApi,
} from './upload_test_helpers.mjs';

test('US-3-T-3 a PDF receipt uploads, is confirmed, and a roommate can download it', async () => {
  await withUploadApi(async (api) => {
    const pdf = await api.upload({ fileName: 'costco-receipt.pdf', contentType: 'application/pdf', bytes: PDF_BYTES });

    assert.equal(pdf.status, 'complete');
    assert.equal(pdf.contentType, 'application/pdf');
    assert.equal(pdf.sizeBytes, PDF_BYTES.length);

    api.signInAs(users.roommate);
    const response = await api.download(pdf.id);
    assert.equal(response.status, 200);
    assert.equal(response.body.attachment.fileName, 'costco-receipt.pdf');
    const file = await fetchSigned(response.body.downloadUrl);
    assert.equal(file.status, 200);
    assert.equal(file.contentType, 'application/pdf');
    assert.ok(file.bytes.equals(PDF_BYTES));
  });
});

test('US-3-T-3 a plain-text expense note uploads and keeps its contents', async () => {
  await withUploadApi(async (api) => {
    const note = await api.upload({ fileName: 'october-utilities.txt', contentType: 'text/plain', bytes: TEXT_BYTES });

    assert.equal(note.status, 'complete');
    assert.equal(note.contentType, 'text/plain');
    const stored = api.state.objects.get(`attachments/${note.id}`);
    assert.equal(stored.bytes.toString(), TEXT_BYTES.toString());
  });
});

test('US-3-T-3 a file sent in a message is offered as a download with its original name', async () => {
  await withUploadApi(async (api) => {
    const pdf = await api.upload({ fileName: 'PG&E bill Oct.pdf', contentType: 'application/pdf', bytes: PDF_BYTES });

    const sent = await api.send({ messageText: 'Utilities are in, $137.40 total', attachmentIds: [pdf.id] });
    assert.equal(sent.status, 201);
    const [inMessage] = sent.body.message.attachments;
    assert.equal(inMessage.fileName, 'PG&E bill Oct.pdf');
    assert.equal(inMessage.contentType, 'application/pdf');

    // Unlike pictures, other files download as an attachment, keeping the name.
    const file = await fetchSigned(inMessage.url);
    assert.equal(file.status, 200);
    assert.equal(file.disposition, `attachment; filename*=UTF-8''${encodeURIComponent('PG&E bill Oct.pdf')}`);
    assert.ok(file.bytes.equals(PDF_BYTES));
  });
});

test('US-3-T-3 a message can carry a photo and a PDF together, in the order given', async () => {
  await withUploadApi(async (api) => {
    const pdf = await api.upload({ fileName: 'invoice.pdf', contentType: 'application/pdf', bytes: PDF_BYTES });
    const photo = await api.upload({ fileName: 'receipt.png', contentType: 'image/png', bytes: PNG_BYTES });

    const sent = await api.send({ messageText: 'Internet + router', attachmentIds: [photo.id, pdf.id] });
    assert.equal(sent.status, 201);
    assert.deepEqual(sent.body.message.attachments.map((a) => a.id), [photo.id, pdf.id]);
  });
});

test('US-3-T-3 a message can have up to 5 files; 6 is rejected', async () => {
  await withUploadApi(async (api) => {
    const ids = [];
    for (let i = 1; i <= 6; i += 1) {
      const file = await api.upload({ fileName: `receipt-${i}.txt`, contentType: 'text/plain', bytes: TEXT_BYTES });
      ids.push(file.id);
    }

    const tooMany = await api.send({ messageText: 'all receipts', attachmentIds: ids });
    assert.equal(tooMany.status, 400);
    assert.equal(tooMany.body.error, 'A message can have at most 5 attachments.');
    assert.equal(api.state.posts.length, 0);

    const five = await api.send({ messageText: 'all receipts', attachmentIds: ids.slice(0, 5) });
    assert.equal(five.status, 201);
    assert.equal(five.body.message.attachments.length, 5);
  });
});

test('US-3-T-3 file types that are not images, PDF or plain text are rejected with 415', async () => {
  await withUploadApi(async (api) => {
    const rejected = [
      ['receipts.zip', 'application/zip'],
      ['budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      ['page.html', 'text/html'],
      ['setup.exe', 'application/x-msdownload'],
      ['clip.mp4', 'video/mp4'],
    ];
    for (const [fileName, contentType] of rejected) {
      const response = await api.requestUpload({ fileName, contentType, sizeBytes: 500 });
      assert.equal(response.status, 415, contentType);
      assert.deepEqual(response.body.allowed.sort(), [
        'application/pdf', 'image/gif', 'image/heic', 'image/jpeg', 'image/png', 'image/webp', 'text/plain',
      ]);
    }
    assert.equal(api.state.attachments.length, 0);
  });
});

test('US-3-T-3 content types are matched without regard to case or surrounding spaces', async () => {
  await withUploadApi(async (api) => {
    const response = await api.requestUpload({ fileName: 'r.pdf', contentType: '  Application/PDF ', sizeBytes: 10 });
    assert.equal(response.status, 201);
    assert.deepEqual(response.body.uploadHeaders, { 'Content-Type': 'application/pdf' });
    assert.equal(api.attachment(response.body.attachmentId).contentType, 'application/pdf');
  });
});

test('US-3-T-3 file names are reduced to the last path segment with control characters removed', async () => {
  await withUploadApi(async (api) => {
    const cases = [
      ['../../etc/rent-receipt.pdf', 'rent-receipt.pdf'],
      ['C:\\Users\\olivia\\Desktop\\rent.pdf', 'rent.pdf'],
      ['rent\u0000\n\u007f.pdf', 'rent.pdf'],
      ['  spaced.pdf  ', 'spaced.pdf'],
    ];
    for (const [raw, expected] of cases) {
      const response = await api.requestUpload({ fileName: raw, contentType: 'application/pdf', sizeBytes: 10 });
      assert.equal(response.status, 201, raw);
      assert.equal(api.attachment(response.body.attachmentId).fileName, expected);
    }
  });
});

test('US-3-T-3 file names must be 1 to 255 characters after cleaning', async () => {
  await withUploadApi(async (api) => {
    const error = 'fileName must be between 1 and 255 characters.';
    for (const fileName of ['', '   ', 'folder/', 'x'.repeat(256)]) {
      const response = await api.requestUpload({ fileName, contentType: 'text/plain', sizeBytes: 10 });
      assert.equal(response.status, 400, JSON.stringify(fileName));
      assert.equal(response.body.error, error);
    }
    const longest = await api.requestUpload({ fileName: 'x'.repeat(255), contentType: 'text/plain', sizeBytes: 10 });
    assert.equal(longest.status, 201);
  });
});

test('US-3-T-3 sizes must be whole numbers from 1 byte to 10 MB', async () => {
  await withUploadApi(async (api) => {
    for (const sizeBytes of [0, -5, 1.5, MAX_BYTES + 1]) {
      const response = await api.requestUpload({ fileName: 'r.pdf', contentType: 'application/pdf', sizeBytes });
      assert.equal(response.status, 413, String(sizeBytes));
    }
    for (const sizeBytes of [1, MAX_BYTES]) {
      const response = await api.requestUpload({ fileName: 'r.pdf', contentType: 'application/pdf', sizeBytes });
      assert.equal(response.status, 201, String(sizeBytes));
    }
  });
});

test('US-3-T-3 a malformed upload request is rejected with 400', async () => {
  await withUploadApi(async (api) => {
    const error = 'fileName and contentType must be strings and sizeBytes a number.';
    const bodies = [
      { contentType: 'application/pdf', sizeBytes: 10 },
      { fileName: 'r.pdf', sizeBytes: 10 },
      { fileName: 'r.pdf', contentType: 'application/pdf' },
      { fileName: 'r.pdf', contentType: 'application/pdf', sizeBytes: '10' },
      { fileName: 42, contentType: 'application/pdf', sizeBytes: 10 },
    ];
    for (const body of bodies) {
      const response = await api.requestUpload(body);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.equal(response.body.error, error);
    }
    assert.equal(api.state.attachments.length, 0);
  });
});

test('US-3-T-3 uploads return 503 when file storage is not configured', async () => {
  await withUploadApi(async (api) => {
    const bucket = process.env.S3_BUCKET;
    delete process.env.S3_BUCKET;
    try {
      const response = await api.requestUpload({ fileName: 'r.pdf', contentType: 'application/pdf', sizeBytes: 10 });
      assert.equal(response.status, 503);
      assert.equal(response.body.error, 'File uploads are not configured on this server.');
      assert.equal(api.state.attachments.length, 0);
    } finally {
      process.env.S3_BUCKET = bucket;
    }
  });
});
