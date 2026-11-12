/*
  Object storage for message attachments.

  Talks to any S3-compatible service (AWS S3, Cloudflare R2, MinIO). The API
  server never touches file bytes: it signs a short-lived PUT URL, the client
  uploads straight to the bucket, and the server later checks the object exists.

  Env: S3_BUCKET (required), S3_REGION (default "auto"), S3_ENDPOINT (for R2/MinIO),
  S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY (or the usual AWS credential chain).
 */
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const UPLOAD_URL_TTL_SECONDS = 300;
export const DOWNLOAD_URL_TTL_SECONDS = 2 * 60 * 60;

let client: S3Client | undefined;

function bucket(): string {
  const name = process.env.S3_BUCKET;
  if (!name) {
    throw new Error('S3_BUCKET must be set to use file uploads.');
  }
  return name;
}

function s3(): S3Client {
  client ??= new S3Client({
    region: process.env.S3_REGION ?? 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,
    // MinIO needs path-style URLs; harmless for S3 and R2.
    forcePathStyle: Boolean(process.env.S3_ENDPOINT),
    // Newer SDKs add a CRC32 of the (unknown) body to presigned URLs, which makes
    // the real upload fail with a checksum mismatch.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        }
      : undefined,
  });
  return client;
}

export function isStorageConfigured(): boolean {
  return Boolean(process.env.S3_BUCKET);
}

// Content type and length are signed, so the upload only succeeds if the client
// sends exactly the values that were validated and stored.
export function presignUpload(key: string, contentType: string, sizeBytes: number): Promise<string> {
  return getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      ContentType: contentType,
      ContentLength: sizeBytes,
    }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS, signableHeaders: new Set(['content-type', 'content-length']) }
  );
}

// Download links are signed against the start of the current hour, so the same file gets the
// same URL for a whole hour. The chat polls every few seconds, and a URL that changed on every
// poll would make each image reload. The link stays valid for at least one more hour.
const SIGNING_WINDOW_MS = 60 * 60 * 1000;

export function presignDownload(key: string, fileName: string, inline = false): Promise<string> {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ResponseContentDisposition: inline
        ? 'inline'
        : `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    }),
    {
      expiresIn: DOWNLOAD_URL_TTL_SECONDS,
      signingDate: new Date(Math.floor(Date.now() / SIGNING_WINDOW_MS) * SIGNING_WINDOW_MS),
    }
  );
}

// Types the app shows as a picture inside the chat (HEIC is left out: most browsers can't draw it).
const PREVIEWABLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export interface StoredAttachment {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: string | number;
  objectKey: string;
}

// The shape clients receive inside a message: no storage key, but a download URL.
export async function publicAttachment(attachment: StoredAttachment) {
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    sizeBytes: Number(attachment.sizeBytes),
    url: await presignDownload(
      attachment.objectKey,
      attachment.fileName,
      PREVIEWABLE_TYPES.has(attachment.contentType)
    ),
  };
}

// Signs every attachment of a message. A storage failure on one file is logged and that file is
// left out, so a single bad object can never turn the whole message list into a 500.
export async function publicAttachments(attachments: StoredAttachment[]) {
  const settled = await Promise.allSettled(attachments.map(publicAttachment));
  return settled.flatMap((result, index) => {
    if (result.status === 'fulfilled') return [result.value];
    console.error(`Could not sign download URL for attachment ${attachments[index].id}:`, result.reason);
    return [];
  });
}

// Returns the stored object's size, or null when nothing has been uploaded yet.
export async function objectSize(key: string): Promise<number | null> {
  try {
    const head = await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return head.ContentLength ?? 0;
  } catch (error) {
    const name = (error as { name?: string }).name;
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (name === 'NotFound' || name === 'NoSuchKey' || status === 404) {
      return null;
    }
    throw error;
  }
}
