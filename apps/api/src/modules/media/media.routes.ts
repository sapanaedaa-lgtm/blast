import { Router } from "express";
import { requireAuth } from "@/middleware/auth";
import { uploadMedia } from "@/middleware/upload";
import { asyncHandler } from "@/utils/asyncHandler";
import * as mediaController from "./media.controller";

const router = Router();
router.use(requireAuth);

/**
 * @openapi
 * /media/upload:
 *   post:
 *     tags: [Media]
 *     summary: Upload a media file (image/video, max 50MB by default) with auto-compression
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       201: { description: Media uploaded }
 */
router.post("/upload", uploadMedia.single("file"), asyncHandler(mediaController.upload));

/**
 * @openapi
 * /media:
 *   get:
 *     tags: [Media]
 *     summary: List uploaded media
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Paginated media list }
 */
router.get("/", asyncHandler(mediaController.list));

/**
 * @openapi
 * /media/files/{fileName}:
 *   get:
 *     tags: [Media]
 *     summary: Download a media file owned by the authenticated user
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: fileName
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: File content }
 *       404: { description: File not found }
 */
router.get("/files/:fileName", asyncHandler(mediaController.file));

/**
 * @openapi
 * /media/{id}:
 *   delete:
 *     tags: [Media]
 *     summary: Delete a media file
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 */
router.delete("/:id", asyncHandler(mediaController.remove));

export default router;
