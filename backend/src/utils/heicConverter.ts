import path from 'path';
import fs from 'fs';
import { logger } from '../lib/logger.js';

/**
 * Converts a HEIC/HEIF file to JPEG in-place using sharp.
 * Returns the new .jpg file path if conversion succeeded,
 * or the original path if the file is not HEIC or conversion failed.
 *
 * Why: iPhones default to HEIC format. Browsers do not support HEIC natively,
 * so we convert on upload to ensure HR can preview documents in the browser.
 */
export async function convertHeicToJpeg(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.heic' && ext !== '.heif') return filePath;

  const jpegPath = filePath.replace(/\.(heic|heif)$/i, '.jpg');
  try {
    const { default: sharp } = await import('sharp');
    await sharp(filePath).jpeg({ quality: 90 }).toFile(jpegPath);
    try { fs.unlinkSync(filePath); } catch { /* ignore — file may already be gone */ }
    logger.info(`[heicConverter] ${path.basename(filePath)} → ${path.basename(jpegPath)}`);
    return jpegPath;
  } catch (err: any) {
    // Graceful fallback — sharp HEIC support requires libvips with HEIC enabled.
    // Keep the original file so uploads don't fail silently.
    logger.warn(`[heicConverter] Could not convert ${path.basename(filePath)}: ${err.message}`);
    return filePath;
  }
}

/**
 * If the multer req.file is HEIC/HEIF, converts it to JPEG and mutates
 * req.file (filename, path, mimetype, originalname) in-place.
 * No-op for non-HEIC files.
 */
export async function convertUploadedHeic(req: any): Promise<void> {
  if (!req.file) return;
  const ext = path.extname(req.file.filename).toLowerCase();
  if (ext !== '.heic' && ext !== '.heif') return;

  const newPath = await convertHeicToJpeg(req.file.path);
  if (newPath !== req.file.path) {
    req.file.path = newPath;
    req.file.filename = path.basename(newPath);
    req.file.mimetype = 'image/jpeg';
    req.file.originalname = req.file.originalname.replace(/\.(heic|heif)$/i, '.jpg');
  }
}
