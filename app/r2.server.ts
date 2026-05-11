import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME!;
const PUBLIC_URL = process.env.R2_PUBLIC_URL!;

/**
 * Build an R2 object key following the convention: {module}/{shopId}/{resourceId}/{filename}
 */
export function buildR2Key(
  module: string,
  shopId: string,
  resourceId: string,
  filename: string
): string {
  return `${module}/${shopId}/${resourceId}/${filename}`;
}

/**
 * Build the public CDN URL for a given R2 key.
 */
export function buildCdnUrl(key: string): string {
  return `${PUBLIC_URL}/${key}`;
}

/**
 * Upload a file to R2 with retry-once logic on failure.
 * Returns the public CDN URL on success.
 */
export async function uploadFile(
  key: string,
  body: Buffer,
  contentType: string
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  });

  try {
    await r2.send(command);
    return buildCdnUrl(key);
  } catch (error) {
    // Retry once
    try {
      await r2.send(command);
      return buildCdnUrl(key);
    } catch (retryError) {
      throw new Error(
        `R2 upload failed after retry: ${retryError instanceof Error ? retryError.message : "Unknown error"}`
      );
    }
  }
}

/**
 * Delete a single file from R2.
 */
export async function deleteFile(key: string): Promise<void> {
  await r2.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key,
    })
  );
}

/**
 * Delete all files under a given prefix (folder) from R2.
 */
export async function deleteFolder(prefix: string): Promise<void> {
  const listResponse = await r2.send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
    })
  );

  if (!listResponse.Contents || listResponse.Contents.length === 0) return;

  await r2.send(
    new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: {
        Objects: listResponse.Contents.map((obj) => ({ Key: obj.Key })),
      },
    })
  );
}

/** Maximum allowed file size: 10 MB */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Allowed image MIME types for upload */
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

/**
 * Validate file size and content type before upload.
 */
export function validateFileUpload(
  size: number,
  contentType: string
): { valid: boolean; error?: string } {
  if (size > MAX_FILE_SIZE) {
    return { valid: false, error: "File size exceeds maximum of 10 MB" };
  }
  if (!ALLOWED_IMAGE_TYPES.includes(contentType)) {
    return {
      valid: false,
      error: `File type ${contentType} is not allowed. Accepted: JPEG, PNG, WebP, GIF`,
    };
  }
  return { valid: true };
}

export { r2 };
