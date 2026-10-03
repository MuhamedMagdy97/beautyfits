import { describe, expect, it } from "vitest";
import { inspectImage } from "@/server/modules/media/image-inspection";
import { builtInScanner } from "@/server/modules/media/scanner";
import { MAX_UPLOAD_BYTES, startUploadSchema } from "@/server/modules/media/schemas";
import { jpeg, png, webp } from "@/test/fixtures/images";

/** Upload checks that need no database (TASK-016, Q176, ADR-0021). */

describe("inspectImage", () => {
  it("reads the type and size of PNG, JPEG and WebP images from their bytes", () => {
    expect(inspectImage(png(640, 480))).toEqual({
      ok: true,
      mimeType: "image/png",
      width: 640,
      height: 480,
    });
    expect(inspectImage(jpeg(1200, 800))).toEqual({
      ok: true,
      mimeType: "image/jpeg",
      width: 1200,
      height: 800,
    });
    expect(inspectImage(webp(700, 900))).toEqual({
      ok: true,
      mimeType: "image/webp",
      width: 700,
      height: 900,
    });
  });

  it("refuses files that are not JPEG, PNG or WebP", () => {
    for (const bytes of [
      Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
      Buffer.from("GIF89a\x01\x00\x01\x00", "latin1"),
      Buffer.from("%PDF-1.7\n"),
      Buffer.alloc(0),
    ]) {
      expect(inspectImage(bytes)).toEqual({ ok: false, problem: "file_type_not_allowed" });
    }
  });

  it("refuses truncated and malformed images", () => {
    const full = [png(600, 600), jpeg(600, 600), webp(600, 600)];
    for (const bytes of full) {
      expect(inspectImage(bytes.subarray(0, bytes.length - 5))).toMatchObject({ ok: false });
      expect(inspectImage(bytes.subarray(0, 14))).toMatchObject({ ok: false });
    }
    const noEnd = jpeg(600, 600).subarray(0, -2);
    expect(inspectImage(noEnd)).toEqual({ ok: false, problem: "file_corrupt" });
  });

  it("refuses data appended after the end of the image, but accepts zero padding", () => {
    const hidden = Buffer.from("PK\x03\x04 a zip archive", "latin1");
    for (const bytes of [png(600, 600), jpeg(600, 600)]) {
      expect(inspectImage(Buffer.concat([bytes, hidden]))).toEqual({
        ok: false,
        problem: "file_trailing_data",
      });
      expect(inspectImage(Buffer.concat([bytes, Buffer.alloc(16)]))).toMatchObject({ ok: true });
    }
    // A RIFF file declares its own length; anything beyond it is extra.
    expect(inspectImage(Buffer.concat([webp(600, 600), hidden]))).toEqual({
      ok: false,
      problem: "file_trailing_data",
    });
  });

  it("refuses animated PNG and WebP images", () => {
    const animatedPng = png(600, 600, {
      extraChunks: [{ type: "acTL", data: Buffer.from([0, 0, 0, 2, 0, 0, 0, 0]) }],
    });
    expect(inspectImage(animatedPng)).toEqual({ ok: false, problem: "image_animated" });
    expect(inspectImage(webp(600, 600, { animated: true }))).toEqual({
      ok: false,
      problem: "image_animated",
    });
  });
});

describe("builtInScanner", () => {
  it("passes plain images and refuses markup or script hidden inside one", async () => {
    expect(await builtInScanner.scan(png(600, 600))).toEqual({ safe: true });
    for (const payload of [
      "<script>alert(1)</script>",
      "<?php system($_GET['c']); ?>",
      "<SVG onload=x>",
    ]) {
      expect(await builtInScanner.scan(jpeg(600, 600, { comment: payload }))).toEqual({
        safe: false,
        reason: "file_content_suspicious",
      });
    }
  });
});

describe("startUploadSchema", () => {
  const valid = {
    purpose: "PRODUCT_MEDIA",
    filename: "lipstick.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 1000,
  };

  it("keeps only the base name of the file", () => {
    expect(
      startUploadSchema.parse({ ...valid, filename: "C:\\Users\\me\\Pictures\\Rose Lipstick.JPEG" })
        .filename,
    ).toBe("Rose Lipstick.JPEG");
    expect(startUploadSchema.parse({ ...valid, filename: "../../etc/lipstick.jpg" }).filename).toBe(
      "lipstick.jpg",
    );
  });

  it("refuses other types, sizes over the limit and names that do not match the type", () => {
    expect(startUploadSchema.safeParse({ ...valid, mimeType: "image/svg+xml" }).success).toBe(
      false,
    );
    expect(startUploadSchema.safeParse({ ...valid, mimeType: "image/gif" }).success).toBe(false);
    expect(startUploadSchema.safeParse({ ...valid, sizeBytes: MAX_UPLOAD_BYTES + 1 }).success).toBe(
      false,
    );
    expect(startUploadSchema.safeParse({ ...valid, sizeBytes: 0 }).success).toBe(false);
    expect(startUploadSchema.safeParse({ ...valid, purpose: "RETURN_EVIDENCE" }).success).toBe(
      false,
    );
    const mismatch = startUploadSchema.safeParse({ ...valid, filename: "lipstick.png" });
    expect(mismatch.success).toBe(false);
    expect(startUploadSchema.safeParse({ ...valid, filename: "lipstick" }).success).toBe(false);
    expect(startUploadSchema.safeParse({ ...valid, filename: "/" }).success).toBe(false);
  });
});
