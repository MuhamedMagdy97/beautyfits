/**
 * Reads what an uploaded image really is from its bytes (TASK-016, Q176,
 * ADR-0021): the type from the file signature and the size in pixels from
 * the header, without decoding the picture. The declared type and file name
 * are never trusted.
 *
 * The structure of the whole file is walked, so a file is accepted only when
 * it is one well-formed image: truncated files, unknown chunk layouts,
 * animations and data appended after the end of the image (a common way to
 * hide another file inside a picture) are refused.
 */

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

/** File name extensions accepted for each type; the first is used for storage. */
export const IMAGE_EXTENSIONS: Record<ImageMimeType, readonly string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
};

export function isImageMimeType(value: string): value is ImageMimeType {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

/** Why a file is not an acceptable image (stable issue codes, API "TASK-016 Amendments"). */
export type ImageProblem =
  "file_type_not_allowed" | "file_corrupt" | "file_trailing_data" | "image_animated";

export type ImageInspection =
  | { ok: true; mimeType: ImageMimeType; width: number; height: number }
  | { ok: false; problem: ImageProblem };

class Problem extends Error {
  constructor(readonly problem: ImageProblem) {
    super(problem);
  }
}

function fail(problem: ImageProblem = "file_corrupt"): never {
  throw new Problem(problem);
}

/** Bytes after the end of the image are accepted only as zero padding. */
function assertNoTrailingData(bytes: Buffer, end: number): void {
  for (let i = end; i < bytes.length; i += 1) {
    if (bytes[i] !== 0) {
      fail("file_trailing_data");
    }
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function inspectPng(bytes: Buffer): { width: number; height: number } {
  let offset = PNG_SIGNATURE.length;
  let size: { width: number; height: number } | null = null;
  let sawData = false;
  for (;;) {
    if (offset + 12 > bytes.length) {
      fail();
    }
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const next = dataStart + length + 4; // data + CRC
    if (!/^[A-Za-z]{4}$/.test(type) || next > bytes.length) {
      fail();
    }
    if (size === null) {
      if (type !== "IHDR" || length !== 13) {
        fail();
      }
      size = { width: bytes.readUInt32BE(dataStart), height: bytes.readUInt32BE(dataStart + 4) };
    } else if (type === "acTL" || type === "fcTL") {
      fail("image_animated");
    } else if (type === "IDAT") {
      sawData = true;
    }
    offset = next;
    if (type === "IEND") {
      break;
    }
  }
  if (!sawData) {
    fail();
  }
  assertNoTrailingData(bytes, offset);
  return size!;
}

/** Start-of-frame markers that carry the image size (not DHT, JPG, DAC). */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function inspectJpeg(bytes: Buffer): { width: number; height: number } {
  let offset = 2; // after SOI (FF D8)
  let size: { width: number; height: number } | null = null;
  let sawScan = false;
  for (;;) {
    if (offset >= bytes.length || bytes[offset] !== 0xff) {
      fail();
    }
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1; // fill bytes
    }
    if (offset >= bytes.length) {
      fail();
    }
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) {
      break; // EOI
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue; // markers without a length
    }
    if (marker === 0xd8 || marker === 0x00 || offset + 2 > bytes.length) {
      fail();
    }
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) {
      fail();
    }
    if (isStartOfFrame(marker)) {
      if (length < 7 || size !== null) {
        fail();
      }
      size = { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += length;
    if (marker === 0xda) {
      // Entropy-coded data runs until the next marker other than a stuffed
      // byte (FF 00) or a restart marker (FF D0-D7).
      sawScan = true;
      while (offset < bytes.length) {
        if (bytes[offset] === 0xff && offset + 1 < bytes.length) {
          const following = bytes[offset + 1];
          if (following === 0x00 || (following >= 0xd0 && following <= 0xd7)) {
            offset += 2;
            continue;
          }
          if (following !== 0xff) {
            break;
          }
        }
        offset += 1;
      }
    }
  }
  if (!sawScan || size === null || size.width === 0 || size.height === 0) {
    fail();
  }
  assertNoTrailingData(bytes, offset);
  return size;
}

function inspectWebp(bytes: Buffer): { width: number; height: number } {
  const declaredEnd = 8 + bytes.readUInt32LE(4);
  if (declaredEnd > bytes.length || declaredEnd < 20) {
    fail();
  }
  let offset = 12;
  let size: { width: number; height: number } | null = null;
  let sawImage = false;
  while (offset < declaredEnd) {
    if (offset + 8 > declaredEnd) {
      fail();
    }
    const type = bytes.toString("latin1", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const data = offset + 8;
    const next = data + length + (length % 2); // chunks are padded to an even size
    if (!/^[A-Z0-9 ]{4}$/.test(type) || data + length > declaredEnd) {
      fail();
    }
    const first = offset === 12;
    if (type === "ANIM" || type === "ANMF") {
      fail("image_animated");
    } else if (type === "VP8X") {
      if (!first || length < 10) {
        fail();
      }
      if ((bytes[data] & 0x02) !== 0) {
        fail("image_animated");
      }
      size = {
        width: 1 + bytes.readUIntLE(data + 4, 3),
        height: 1 + bytes.readUIntLE(data + 7, 3),
      };
    } else if (type === "VP8 ") {
      if (sawImage || length < 10) {
        fail();
      }
      if (bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) {
        fail();
      }
      sawImage = true;
      const frame = {
        width: bytes.readUInt16LE(data + 6) & 0x3fff,
        height: bytes.readUInt16LE(data + 8) & 0x3fff,
      };
      size ??= frame;
    } else if (type === "VP8L") {
      if (sawImage || length < 5 || bytes[data] !== 0x2f) {
        fail();
      }
      sawImage = true;
      const bits = bytes.readUInt32LE(data + 1);
      const frame = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      size ??= frame;
    } else if (first) {
      fail();
    }
    offset = next;
  }
  if (
    offset !== declaredEnd ||
    !sawImage ||
    size === null ||
    size.width === 0 ||
    size.height === 0
  ) {
    fail();
  }
  assertNoTrailingData(bytes, declaredEnd);
  return size;
}

function detectType(bytes: Buffer): ImageMimeType | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("latin1", 0, 4) === "RIFF" &&
    bytes.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** Identifies a JPEG, PNG or WebP image and reads its size from the bytes. */
export function inspectImage(bytes: Buffer): ImageInspection {
  const mimeType = detectType(bytes);
  if (mimeType === null) {
    return { ok: false, problem: "file_type_not_allowed" };
  }
  try {
    const size =
      mimeType === "image/png"
        ? inspectPng(bytes)
        : mimeType === "image/jpeg"
          ? inspectJpeg(bytes)
          : inspectWebp(bytes);
    return { ok: true, mimeType, ...size };
  } catch (error) {
    if (error instanceof Problem) {
      return { ok: false, problem: error.problem };
    }
    if (error instanceof RangeError) {
      return { ok: false, problem: "file_corrupt" }; // a read past the end
    }
    throw error;
  }
}
