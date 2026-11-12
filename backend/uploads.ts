/*
  File attachments, uploaded directly to object storage.

  1. POST /conversations/:inviteCode/attachments  validate, insert a 'pending' row, return a presigned PUT URL
  2. Client PUTs the file bytes to that URL (never through this server)
  3. POST /attachments/:id/complete                confirm the object exists, mark the row 'complete'
 */
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { Pool } from 'pg';
import { authenticated, getConversationAccess, isRecord, routeParam } from './routes';
import {
  UPLOAD_URL_TTL_SECONDS,
  isStorageConfigured,
  objectSize,
  presignDownload,
  presignUpload,
} from './storage';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'application/pdf',
  'text/plain',
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Keep only the final path segment and drop control characters; the name is
// display-only (the storage key is generated), so this is just hygiene.
function cleanFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  return base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

interface AttachmentRow {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: string;
  status: 'pending' | 'complete';
  createdAt: Date;
  completedAt: Date | null;
}

const ATTACHMENT_COLUMNS = `a.id,
       a.file_name AS "fileName",
       a.content_type AS "contentType",
       a.size_bytes AS "sizeBytes",
       a.status,
       a.created_at AS "createdAt",
       a.completed_at AS "completedAt"`;

// Pick the public fields explicitly so storage keys and uploader ids never leak.
function present(row: AttachmentRow) {
  return {
    id: row.id,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: Number(row.sizeBytes),
    status: row.status,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

export function registerUploadRoutes(app: Express, pool: Pool): void {
  app.post('/conversations/:inviteCode/attachments', authenticated(pool, async (request, response) => {
    if (!isStorageConfigured()) {
      response.status(503).json({ error: 'File uploads are not configured on this server.' });
      return;
    }

    const body: unknown = request.body;
    if (
      !isRecord(body)
      || typeof body.fileName !== 'string'
      || typeof body.contentType !== 'string'
      || typeof body.sizeBytes !== 'number'
    ) {
      response.status(400).json({ error: 'fileName and contentType must be strings and sizeBytes a number.' });
      return;
    }

    const fileName = cleanFileName(body.fileName);
    if (fileName.length < 1 || fileName.length > 255) {
      response.status(400).json({ error: 'fileName must be between 1 and 255 characters.' });
      return;
    }
    const contentType = body.contentType.trim().toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      response.status(415).json({
        error: 'contentType is not allowed.',
        allowed: [...ALLOWED_CONTENT_TYPES],
      });
      return;
    }
    const sizeBytes = body.sizeBytes;
    if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_ATTACHMENT_BYTES) {
      response.status(413).json({
        error: `sizeBytes must be a whole number between 1 and ${MAX_ATTACHMENT_BYTES}.`,
      });
      return;
    }

    const inviteCode = routeParam(request, 'inviteCode');
    const access = await getConversationAccess(pool, inviteCode, request.authUser.id);
    if (access !== 'member') {
      response.status(access === 'not_found' ? 404 : 403).json({
        error: access === 'not_found' ? 'Conversation not found.' : 'User is not a member of this conversation.',
      });
      return;
    }

    const attachmentId = randomUUID();
    const objectKey = `attachments/${attachmentId}`;
    // Sign first: if storage is misconfigured we fail before leaving an orphaned 'pending' row.
    let uploadUrl: string;
    try {
      uploadUrl = await presignUpload(objectKey, contentType, sizeBytes);
    } catch (error) {
      console.error('Could not create upload URL:', error);
      response.status(502).json({ error: 'File storage is unavailable. Please try again later.' });
      return;
    }
    await pool.query(
      `INSERT INTO attachments (id, household_id, uploader_id, object_key, file_name, content_type, size_bytes)
       SELECT $2, h.id, $3, $4, $5, $6, $7
       FROM households h
       WHERE h.invite_code = $1`,
      [inviteCode, attachmentId, request.authUser.id, objectKey, fileName, contentType, sizeBytes]
    );

    response.status(201).json({
      attachmentId,
      status: 'pending',
      uploadUrl,
      uploadMethod: 'PUT',
      // The URL signs these exact headers; the upload is rejected if they differ.
      uploadHeaders: { 'Content-Type': contentType },
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    });
  }));

  app.post('/attachments/:attachmentId/complete', authenticated(pool, async (request, response) => {
    const attachmentId = routeParam(request, 'attachmentId');
    if (!UUID_PATTERN.test(attachmentId)) {
      response.status(404).json({ error: 'Attachment not found.' });
      return;
    }

    const found = await pool.query<AttachmentRow & { objectKey: string; uploaderId: string; sizeBytes: string }>(
      `SELECT ${ATTACHMENT_COLUMNS}, a.object_key AS "objectKey", a.uploader_id AS "uploaderId"
       FROM attachments a
       WHERE a.id = $1`,
      [attachmentId]
    );
    const attachment = found.rows[0];
    if (!attachment || attachment.uploaderId !== request.authUser.id) {
      response.status(404).json({ error: 'Attachment not found.' });
      return;
    }
    if (attachment.status === 'complete') {
      response.json({ attachment: present(attachment) });
      return;
    }

    let storedSize: number | null;
    try {
      storedSize = await objectSize(attachment.objectKey);
    } catch (error) {
      console.error('Could not check uploaded object:', error);
      response.status(502).json({ error: 'File storage is unavailable. Please try again later.' });
      return;
    }
    if (storedSize === null) {
      response.status(409).json({ error: 'The file has not been uploaded yet.' });
      return;
    }
    if (storedSize !== Number(attachment.sizeBytes)) {
      response.status(409).json({ error: 'Uploaded file size does not match the size that was declared.' });
      return;
    }

    // The status guard keeps this safe if two complete calls race.
    await pool.query(
      `UPDATE attachments
       SET status = 'complete', completed_at = now()
       WHERE id = $1 AND status = 'pending'`,
      [attachmentId]
    );
    const updated = await pool.query<AttachmentRow>(
      `SELECT ${ATTACHMENT_COLUMNS} FROM attachments a WHERE a.id = $1`,
      [attachmentId]
    );
    response.json({ attachment: present(updated.rows[0]) });
  }));

  // Short-lived download link, for members of the attachment's household only.
  app.get('/attachments/:attachmentId', authenticated(pool, async (request, response) => {
    const attachmentId = routeParam(request, 'attachmentId');
    if (!UUID_PATTERN.test(attachmentId)) {
      response.status(404).json({ error: 'Attachment not found.' });
      return;
    }

    const found = await pool.query<AttachmentRow & { objectKey: string }>(
      `SELECT ${ATTACHMENT_COLUMNS}, a.object_key AS "objectKey"
       FROM attachments a
       JOIN household_members hm ON hm.household_id = a.household_id AND hm.user_id = $2
       WHERE a.id = $1 AND a.status = 'complete'`,
      [attachmentId, request.authUser.id]
    );
    const attachment = found.rows[0];
    if (!attachment) {
      response.status(404).json({ error: 'Attachment not found.' });
      return;
    }

    let downloadUrl: string;
    try {
      downloadUrl = await presignDownload(attachment.objectKey, attachment.fileName);
    } catch (error) {
      console.error('Could not create download URL:', error);
      response.status(502).json({ error: 'File storage is unavailable. Please try again later.' });
      return;
    }
    response.json({ attachment: present(attachment), downloadUrl });
  }));
}
