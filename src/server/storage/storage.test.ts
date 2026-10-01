import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createLocalFileStorage, StoredObjectTooLargeError } from "@/server/storage/storage";

/** Local file storage (ADR-0021). */

const root = await mkdtemp(join(tmpdir(), "beautyfits-storage-"));
const storage = createLocalFileStorage(root);

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
}

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("local file storage", () => {
  it("stores, replaces, reads and removes files by object key", async () => {
    expect(await storage.put("product-media/a.png", streamOf("ab", "cd"), 10)).toBe(4);
    expect((await storage.read("product-media/a.png"))?.toString()).toBe("abcd");
    await storage.put("product-media/a.png", streamOf("xyz"), 10);
    expect((await storage.read("product-media/a.png"))?.toString()).toBe("xyz");
    await storage.remove("product-media/a.png");
    expect(await storage.read("product-media/a.png")).toBeNull();
    await storage.remove("product-media/a.png");
  });

  it("stores nothing when the stream is longer than allowed", async () => {
    await expect(
      storage.put("product-media/big.png", streamOf("12345", "6789"), 8),
    ).rejects.toThrow(StoredObjectTooLargeError);
    expect(await storage.read("product-media/big.png")).toBeNull();
    // No partial file is left behind.
    expect(
      (await readdir(join(root, "product-media"))).some((name) => name.endsWith(".part")),
    ).toBe(false);
  });

  it("refuses keys that could leave the storage directory", async () => {
    for (const key of [
      "../outside.png",
      "/etc/passwd.png",
      "a/../../b.png",
      "Upper.png",
      "noext",
    ]) {
      await expect(storage.read(key)).rejects.toThrow("Invalid object key");
    }
  });
});
