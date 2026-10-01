import { crc32, deflateSync } from "node:zlib";

/**
 * Small image files built in memory for upload tests (TASK-016). PNGs are
 * complete, valid images (one gray colour); JPEG and WebP files have a valid
 * structure and header, which is all the upload checks read. Test-only.
 */

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function png(
  width: number,
  height: number,
  options: { extraChunks?: { type: string; data: Buffer }[] } = {},
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // grayscale
  // One filter byte per row, then one gray byte per pixel.
  const raw = Buffer.alloc((width + 1) * height, 0x80);
  for (let row = 0; row < height; row += 1) {
    raw[row * (width + 1)] = 0;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    ...(options.extraChunks ?? []).map((chunk) => pngChunk(chunk.type, chunk.data)),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function jpegSegment(marker: number, data: Buffer): Buffer {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([head, data]);
}

export function jpeg(width: number, height: number, options: { comment?: string } = {}): Buffer {
  const frame = Buffer.from([8, 0, 0, 0, 0, 1, 1, 0x11, 0]);
  frame.writeUInt16BE(height, 1);
  frame.writeUInt16BE(width, 3);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
    ...(options.comment ? [jpegSegment(0xfe, Buffer.from(options.comment, "latin1"))] : []),
    jpegSegment(0xdb, Buffer.alloc(65, 1)),
    jpegSegment(0xc0, frame),
    jpegSegment(0xc4, Buffer.alloc(20, 0)),
    jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
    // Entropy-coded data with a stuffed byte (FF 00) and a restart marker.
    Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78, 0x9a]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function riffChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(type, 0, "latin1");
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

/** A lossless (VP8L) WebP, or with `animated` an extended (VP8X) one with the animation flag. */
export function webp(width: number, height: number, options: { animated?: boolean } = {}): Buffer {
  const lossless = Buffer.alloc(10);
  lossless[0] = 0x2f;
  lossless.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 1);
  const chunks: Buffer[] = [];
  if (options.animated) {
    const extended = Buffer.alloc(10);
    extended[0] = 0x02;
    extended.writeUIntLE(width - 1, 4, 3);
    extended.writeUIntLE(height - 1, 7, 3);
    chunks.push(riffChunk("VP8X", extended));
  }
  chunks.push(riffChunk("VP8L", lossless));
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), ...chunks]);
  const head = Buffer.alloc(8);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}
