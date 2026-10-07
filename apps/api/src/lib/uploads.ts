import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { HttpError } from "./errors.js";

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const IMAGE_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export const imageUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomBytes(6).toString("hex")}${IMAGE_TYPES[file.mimetype]}`),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_TYPES[file.mimetype]) cb(null, true);
    else cb(new HttpError(400, "Only PNG, JPEG, WebP or GIF images are allowed"));
  },
});

/** Resolves an "/uploads/<file>" URL to a file on disk, refusing anything outside the upload folder. */
export function uploadedFilePath(url: string) {
  const match = /^\/uploads\/([\w.-]+)$/.exec(url);
  if (!match) return null;
  const file = path.join(UPLOAD_DIR, match[1]);
  return path.dirname(file) === UPLOAD_DIR && fs.existsSync(file) ? file : null;
}

export function mediaTypeOf(file: string) {
  const ext = path.extname(file).toLowerCase();
  const entry = Object.entries(IMAGE_TYPES).find(([, e]) => e === ext || (ext === ".jpeg" && e === ".jpg"));
  return entry?.[0];
}
