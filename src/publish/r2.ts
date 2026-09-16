import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { Storage } from './storage'

export interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

const R2_VARIABLES = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const

/** Names what is missing, never what is set: this message ends up in terminals and logs. */
export function r2ConfigFromEnv(env: Record<string, string | undefined>): R2Config {
  const missing = R2_VARIABLES.filter((name) => !env[name])
  if (missing.length > 0) {
    throw new Error(`STORAGE=r2 needs ${missing.join(', ')}`)
  }
  return {
    accountId: env.R2_ACCOUNT_ID!,
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    bucket: env.R2_BUCKET!,
  }
}

export function r2Client(config: R2Config): S3Client {
  return new S3Client({
    // Required by the SDK and ignored by R2.
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // Recent SDK versions attach CRC32 checksums to every upload by default.
    // Sending them only where an operation requires one keeps uploads on the
    // path Cloudflare's R2 examples document.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
}

/** A year, never revalidated. Only for keys whose bytes can never change. */
export const IMMUTABLE = 'public, max-age=31536000, immutable'

export interface StoredObject {
  bucket: string
  key: string
  body: string | Uint8Array
  contentType: string
  cacheControl: string
}

export async function putObject(client: Pick<S3Client, 'send'>, object: StoredObject): Promise<void> {
  await client.send(new PutObjectCommand({
    Bucket: object.bucket,
    Key: object.key,
    Body: object.body,
    ContentType: object.contentType,
    CacheControl: object.cacheControl,
  }))
}

/**
 * Artifacts on R2, under `artifacts/` so tile archives can share the bucket
 * and its one custom domain.
 *
 * Every artifact key carries its content hash (`artifactKey` in ./hash.ts), so
 * the bytes behind a key never change and `immutable` is true. Old keys are
 * never deleted: an ISR page cached a few minutes ago may still point at one.
 */
export function r2Storage(client: Pick<S3Client, 'send'>, bucket: string): Storage {
  return {
    async put(key, body, contentType) {
      await putObject(client, {
        bucket,
        key: `artifacts/${key}`,
        body,
        contentType,
        cacheControl: IMMUTABLE,
      })
    },
  }
}
