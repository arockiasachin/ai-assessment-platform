import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, resolve, sep } from "node:path"

/**
 * Object storage for submission attachments.
 *
 * This is a **leaf module on purpose**: it imports only Node builtins, never
 * Next.js and never Prisma, so it can be reached from a route handler, from the
 * retention purge (which also runs under `tsx` from a script), and from a unit
 * test without dragging a framework or a database connection in. The database
 * half of an attachment is `SubmissionAttachment.storageKey`, which is the only
 * link between this module and the schema — this module never reads or writes
 * Prisma itself.
 *
 * The interface is deliberately three methods (`put`/`get`/`delete`) so a
 * different backend can replace `createLocalDiskStorage` without any caller
 * changing. The local-disk driver is a development/testbed choice; a deployment
 * needs a persistent volume or a driver pointing at S3/R2/object storage.
 *
 * KEYS
 * ----
 * A key is an opaque, caller-supplied string. {@link createStorageKey} produces
 * the one this application uses (`<submissionId>/<uuid>`), but the driver treats
 * it as untrusted: a key that is absolute or escapes the root is refused rather
 * than resolved, so a malformed or hostile key can never read or write outside
 * the configured directory.
 */

/** Environment variable naming the directory the local-disk driver is rooted at. */
export const STORAGE_DIR_ENV_VAR = "SUBMISSION_STORAGE_DIR"

/**
 * The environment surface this module reads. A plain map rather than
 * `NodeJS.ProcessEnv`, so a test can pass a small object without fabricating
 * Next.js's required `NODE_ENV` (the same shape `lib/llm/env.ts` uses).
 */
export type StorageEnv = { [key: string]: string | undefined }

/** Default root, relative to the process working directory, when the env var is unset. */
export const DEFAULT_STORAGE_DIR = join(".data", "submission-attachments")

export type PutOptions = {
  /**
   * The object's content type. Retained for drivers that store it (S3/R2); the
   * local-disk driver ignores it, because the content type is kept on the
   * `SubmissionAttachment` row instead.
   */
  contentType?: string
}

/**
 * The storage contract. Swappable for S3/R2 later: every caller depends on this
 * interface, never on the local-disk implementation.
 */
export interface Storage {
  /** Write `data` at `key`, creating parent directories as needed. Overwrites. */
  put(key: string, data: Uint8Array, options?: PutOptions): Promise<void>
  /**
   * Read the object at `key`.
   *
   * @throws {StorageObjectNotFoundError} when no object exists at the key.
   */
  get(key: string): Promise<Buffer>
  /**
   * Remove the object at `key`. **Idempotent**: deleting a key that is already
   * absent resolves rather than throwing, which is what the retention purge
   * needs to be safely re-runnable.
   */
  delete(key: string): Promise<void>
}

/** A key that would escape the storage root, or is otherwise unusable. */
export class InvalidStorageKeyError extends Error {
  constructor(key: string) {
    super(`Refusing storage key "${key}": it must be a relative path inside the storage root.`)
    this.name = "InvalidStorageKeyError"
  }
}

/** No object exists at the requested key. */
export class StorageObjectNotFoundError extends Error {
  constructor(readonly key: string) {
    super("Stored object not found.")
    this.name = "StorageObjectNotFoundError"
  }
}

/** Resolve the configured storage root. Read per call, so tests can override it. */
export function resolveStorageDir(env: StorageEnv = process.env): string {
  const configured = env[STORAGE_DIR_ENV_VAR]?.trim()
  return resolve(
    configured && configured.length > 0 ? configured : join(process.cwd(), DEFAULT_STORAGE_DIR),
  )
}

/**
 * Build a key scoped to a submission. The random suffix means two uploads to the
 * same submission never collide, and the submission prefix keeps one submission's
 * files together for a future per-submission sweep.
 */
export function createStorageKey(submissionId: string): string {
  return `${submissionId}/${randomUUID()}`
}

/** Resolve `key` under `rootDir`, refusing anything that escapes the root. */
function resolveObjectPath(rootDir: string, key: string): string {
  if (!key || key.includes("\0") || isAbsolute(key)) throw new InvalidStorageKeyError(key)
  const root = resolve(rootDir)
  const target = resolve(root, key)
  if (target !== root && !target.startsWith(root + sep)) throw new InvalidStorageKeyError(key)
  return target
}

/**
 * The local-disk driver. Files land at `<rootDir>/<key>`; the key's `/`
 * separators become real subdirectories (so a submission's files live in a
 * directory named after its id).
 */
export function createLocalDiskStorage(rootDir: string): Storage {
  const root = resolve(rootDir)

  return {
    async put(key, data) {
      const target = resolveObjectPath(root, key)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, data)
    },

    async get(key) {
      const target = resolveObjectPath(root, key)
      try {
        return await readFile(target)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new StorageObjectNotFoundError(key)
        }
        throw error
      }
    },

    async delete(key) {
      const target = resolveObjectPath(root, key)
      // `force: true` makes a missing object a no-op, so the purge can retry
      // safely after a partial failure.
      await rm(target, { force: true })
    },
  }
}

/**
 * The storage driver the application uses, resolved from the environment.
 *
 * Constructed per call rather than memoised: it holds no connection or state
 * (only a root path), and reading the environment each time keeps a test from
 * having to reset a module-level singleton to point at a temporary directory.
 * Swapping to S3/R2 means changing this one function's body.
 */
export function getStorage(env: StorageEnv = process.env): Storage {
  return createLocalDiskStorage(resolveStorageDir(env))
}
