import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { getEnv } from "@/server/config/env";

/**
 * File storage for uploaded files (ADR-0021, Architecture §20).
 *
 * Callers depend on the `FileStorage` port and address files by an object
 * key the server generates (never by an uploaded file name). No storage
 * provider is chosen yet, so the only implementation keeps files in a local
 * directory (`MEDIA_DIR`). A provider (object storage) replaces it later
 * without changing callers. PostgreSQL holds metadata only.
 */

export const LOCAL_STORAGE_PROVIDER = "LOCAL";

/** Object keys: lowercase segments of letters, digits, `-`, `_` and one `.ext`. */
const OBJECT_KEY_PATTERN = /^[a-z0-9_-]+(\/[a-z0-9_-]+)*\.[a-z0-9]+$/;

export class StoredObjectTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`The file is larger than ${maxBytes} bytes`);
    this.name = "StoredObjectTooLargeError";
  }
}

export interface FileStorage {
  /** Name stored in `media_assets.storage_provider`. */
  readonly provider: string;
  /**
   * Stores the bytes under `key`, replacing an earlier copy. Throws
   * `StoredObjectTooLargeError` (and stores nothing) when the stream is
   * longer than `maxBytes`. Returns the number of bytes stored.
   */
  put(key: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<number>;
  /** The whole file, or null when nothing is stored under `key`. */
  read(key: string): Promise<Buffer | null>;
  /** Removes the file; does nothing when it does not exist. */
  remove(key: string): Promise<void>;
}

/** Stores each object as `<root>/<key>`. */
export function createLocalFileStorage(root: string): FileStorage {
  const base = resolve(root);

  function pathOf(key: string): string {
    if (!OBJECT_KEY_PATTERN.test(key)) {
      throw new Error("Invalid object key");
    }
    const path = resolve(base, key);
    const rel = relative(base, path);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error("Invalid object key");
    }
    return path;
  }

  return {
    provider: LOCAL_STORAGE_PROVIDER,

    async put(key, body, maxBytes) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      // Written next to the target and renamed once complete, so a reader
      // never sees a partial file and a failed upload leaves the old copy.
      const partial = `${path}.${randomUUID()}.part`;
      let size = 0;
      // Bytes over the limit are read and dropped rather than cancelling the
      // request body mid-stream (which the HTTP server does not expect).
      const limit = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          size += chunk.byteLength;
          callback(null, size > maxBytes ? undefined : chunk);
        },
      });
      try {
        await pipeline(
          Readable.fromWeb(body as WebReadableStream<Uint8Array>),
          limit,
          createWriteStream(partial, { flags: "wx", mode: 0o600 }),
        );
        if (size > maxBytes) {
          throw new StoredObjectTooLargeError(maxBytes);
        }
        await rename(partial, path);
        return size;
      } catch (error) {
        await rm(partial, { force: true });
        throw error;
      }
    },

    async read(key) {
      try {
        return await readFile(pathOf(key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw error;
      }
    },

    async remove(key) {
      await rm(pathOf(key), { force: true });
    },
  };
}

let defaultStorage: FileStorage | undefined;

export function getFileStorage(): FileStorage {
  defaultStorage ??= createLocalFileStorage(getEnv().MEDIA_DIR);
  return defaultStorage;
}
