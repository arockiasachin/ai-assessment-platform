import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  DEFAULT_STORAGE_DIR,
  InvalidStorageKeyError,
  STORAGE_DIR_ENV_VAR,
  StorageObjectNotFoundError,
  createLocalDiskStorage,
  createStorageKey,
  resolveStorageDir,
} from "@/lib/storage"

/**
 * The local-disk storage driver, exercised against a real temporary directory.
 *
 * These are the driver's own contract tests: bytes round-trip, a missing object
 * is a typed not-found, deletion is idempotent (the purge depends on that), and a
 * key can never escape the configured root.
 */

let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "attachment-storage-"))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("local-disk storage driver", () => {
  it("round-trips bytes and nests the file under the key's subdirectory", async () => {
    const storage = createLocalDiskStorage(root)
    const key = "submission-1/attachment-a"
    const payload = Buffer.from("hello attachment", "utf8")

    await storage.put(key, payload)

    // The physical file lives at <root>/<key> — the key's `/` becomes a directory.
    const onDisk = await readFile(join(root, "submission-1", "attachment-a"))
    expect(onDisk.equals(payload)).toBe(true)

    const readBack = await storage.get(key)
    expect(readBack.equals(payload)).toBe(true)
  })

  it("reports a missing object as StorageObjectNotFoundError", async () => {
    const storage = createLocalDiskStorage(root)
    await expect(storage.get("submission-1/does-not-exist")).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    )
  })

  it("deletes idempotently and removes the file", async () => {
    const storage = createLocalDiskStorage(root)
    const key = "submission-2/attachment-b"
    await storage.put(key, Buffer.from("x"))

    const target = join(root, "submission-2", "attachment-b")
    await expect(stat(target)).resolves.toBeDefined()

    await storage.delete(key)
    await expect(stat(target)).rejects.toThrow()

    // A second delete of an already-absent object must not throw: the retention
    // purge relies on this to be safely re-runnable after a partial failure.
    await expect(storage.delete(key)).resolves.toBeUndefined()
  })

  it("refuses keys that are absolute or escape the root", async () => {
    const storage = createLocalDiskStorage(root)

    await expect(storage.put("/etc/passwd", Buffer.from("x"))).rejects.toBeInstanceOf(
      InvalidStorageKeyError,
    )
    await expect(storage.put("../escaped.txt", Buffer.from("x"))).rejects.toBeInstanceOf(
      InvalidStorageKeyError,
    )
    await expect(storage.get("submission-1/../../escaped.txt")).rejects.toBeInstanceOf(
      InvalidStorageKeyError,
    )
  })
})

describe("storage key helpers", () => {
  it("scopes a generated key to the submission and makes it unique", () => {
    const first = createStorageKey("submission-42")
    const second = createStorageKey("submission-42")

    expect(first.startsWith("submission-42/")).toBe(true)
    expect(first).not.toBe(second)
  })

  it("reads the storage root from the environment, defaulting under the working directory", () => {
    expect(resolveStorageDir({ [STORAGE_DIR_ENV_VAR]: "/tmp/custom-root" })).toBe(
      "/tmp/custom-root",
    )
    expect(resolveStorageDir({})).toBe(join(process.cwd(), DEFAULT_STORAGE_DIR))
  })
})
