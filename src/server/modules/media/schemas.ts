import { z } from "zod";
import {
  IMAGE_EXTENSIONS,
  IMAGE_MIME_TYPES,
  type ImageMimeType,
} from "@/server/modules/media/image-inspection";

/** Request schemas and limits of the upload endpoints (API §28, TASK-016, ADR-0021). */

/** Largest accepted file (ADR-0021 §4). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Smallest and largest accepted width and height of a product image, in pixels. */
export const MIN_IMAGE_SIDE = 500;
export const MAX_IMAGE_SIDE = 6000;
export const FILENAME_MAX = 255;

export const MEDIA_PURPOSES = ["PRODUCT_MEDIA"] as const;

/** The last path segment of a client file name, without control characters. */
function baseName(value: string): string {
  const segments = value.split(/[\\/]/);
  return segments[segments.length - 1].replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : null;
}

export const startUploadSchema = z
  .object({
    purpose: z.enum(MEDIA_PURPOSES),
    filename: z.string().max(1000).transform(baseName).pipe(z.string().min(1).max(FILENAME_MAX)),
    mimeType: z.enum(IMAGE_MIME_TYPES),
    sizeBytes: z
      .number()
      .int()
      .min(1)
      .max(MAX_UPLOAD_BYTES, {
        message: `The file is larger than ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
      }),
  })
  .superRefine((value, ctx) => {
    const extension = extensionOf(value.filename);
    if (
      extension === null ||
      !IMAGE_EXTENSIONS[value.mimeType as ImageMimeType].includes(extension)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["filename"],
        params: { code: "file_extension_mismatch" },
        message: `The file name must end in .${IMAGE_EXTENSIONS[value.mimeType].join(" or .")}.`,
      });
    }
  });

export type StartUploadInput = z.output<typeof startUploadSchema>;

export const completeUploadSchema = z.object({ mediaAssetId: z.uuid() });
