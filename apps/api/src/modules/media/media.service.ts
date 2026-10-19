import path from "path";
import fs from "fs";
import sharp from "sharp";
import { prisma } from "@/config/prisma";
import { env } from "@/config/env";
import { AppError } from "@/utils/AppError";
import { MediaType } from "@prisma/client";

const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const VIDEO_EXT = [".mp4"];

function detectType(ext: string): MediaType {
  if (IMAGE_EXT.includes(ext)) return MediaType.IMAGE;
  if (VIDEO_EXT.includes(ext)) return MediaType.VIDEO;
  return MediaType.DOCUMENT;
}

export async function saveUploadedMedia(userId: string, file: Express.Multer.File) {
  const ext = path.extname(file.originalname).toLowerCase();
  const type = detectType(ext);

  let thumbnailPath: string | undefined;

  // Auto-compress large images and generate a lightweight thumbnail for the UI.
  if (type === MediaType.IMAGE && ext !== ".gif") {
    try {
      const compressedName = `${path.basename(file.filename, ext)}-compressed${ext}`;
      const compressedPath = path.join(path.dirname(file.path), compressedName);
      await sharp(file.path)
        .resize({ width: 1600, withoutEnlargement: true })
        .toFormat(ext === ".png" ? "png" : "jpeg", { quality: 82 })
        .toFile(compressedPath);

      const originalSize = fs.statSync(file.path).size;
      const compressedSize = fs.statSync(compressedPath).size;
      if (compressedSize < originalSize) {
        fs.unlinkSync(file.path);
        fs.renameSync(compressedPath, file.path);
      } else {
        fs.unlinkSync(compressedPath);
      }

      const thumbName = `${path.basename(file.filename, ext)}-thumb.jpg`;
      const thumbPath = path.join(path.dirname(file.path), thumbName);
      await sharp(file.path).resize({ width: 320 }).toFormat("jpeg", { quality: 70 }).toFile(thumbPath);
      thumbnailPath = `/uploads/${thumbName}`;
    } catch {
      // Non-fatal — fall back to serving the original file without a thumbnail.
    }
  }

  const finalSize = fs.statSync(file.path).size;

  const media = await prisma.mediaFile.create({
    data: {
      userId,
      fileName: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      type,
      sizeBytes: finalSize,
      storageDriver: env.STORAGE_DRIVER,
      path: `/uploads/${file.filename}`,
      thumbnailPath,
    },
  });

  return media;
}

export async function listMedia(userId: string, page: number, limit: number) {
  const [items, total] = await Promise.all([
    prisma.mediaFile.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.mediaFile.count({ where: { userId } }),
  ]);
  return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function getMediaFileForUser(userId: string, fileName: string): Promise<string> {
  if (!fileName || fileName !== path.basename(fileName) || fileName.includes("..")) {
    throw AppError.notFound("File tidak ditemukan");
  }
  const publicPath = `/uploads/${fileName}`;
  const media = await prisma.mediaFile.findFirst({
    where: { userId, OR: [{ path: publicPath }, { thumbnailPath: publicPath }] },
  });
  if (!media) throw AppError.notFound("File tidak ditemukan");
  return path.resolve(env.UPLOAD_DIR, fileName);
}

export async function deleteMedia(userId: string, id: string) {
  const media = await prisma.mediaFile.findFirst({ where: { id, userId } });
  if (!media) throw AppError.notFound("Media tidak ditemukan");

  const filePath = path.join(path.resolve(env.UPLOAD_DIR), path.basename(media.path));
  fs.unlink(filePath, () => undefined);
  if (media.thumbnailPath) {
    fs.unlink(path.join(path.resolve(env.UPLOAD_DIR), path.basename(media.thumbnailPath)), () => undefined);
  }

  await prisma.mediaFile.delete({ where: { id } });
  return { success: true };
}
