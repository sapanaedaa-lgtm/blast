import { Router } from "express";
import { validate } from "@/middleware/validate";
import { requireAuth, requireRole } from "@/middleware/auth";
import { authRateLimiter } from "@/middleware/rateLimiter";
import { doubleCsrfProtection } from "@/middleware/csrf";
import { asyncHandler } from "@/utils/asyncHandler";
import { loginSchema, registerSchema } from "./auth.schema";
import * as authController from "./auth.controller";

const router = Router();

/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags: [Authentication]
 *     summary: Register a new user
 *     description: Admin only. Customer accounts are created manually by an administrator.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string }
 *               email: { type: string }
 *               password: { type: string }
 *     responses:
 *       201: { description: User created }
 */
router.post("/register", requireAuth, requireRole("ADMIN"), authRateLimiter, validate(registerSchema), asyncHandler(authController.register));

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Authentication]
 *     summary: Login and receive an access token (refresh token set as httpOnly cookie)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string }
 *               password: { type: string }
 *     responses:
 *       200: { description: Login successful }
 */
router.post("/login", authRateLimiter, validate(loginSchema), asyncHandler(authController.login));

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Authentication]
 *     summary: Exchange refresh token cookie for a new access token
 *     description: >
 *       Cookie-authenticated endpoint — requires a valid CSRF token pair.
 *       Fetch one via `GET /csrf-token` first and send it back as the `X-CSRF-Token` header.
 *     responses:
 *       200: { description: New access token issued }
 */
router.post("/refresh", doubleCsrfProtection, asyncHandler(authController.refresh));

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Authentication]
 *     summary: Revoke refresh token and clear session
 *     description: >
 *       Cookie-authenticated endpoint — requires a valid CSRF token pair (see `/auth/refresh`).
 *     responses:
 *       200: { description: Logged out }
 */
router.post("/logout", requireAuth, doubleCsrfProtection, asyncHandler(authController.logout));

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Authentication]
 *     summary: Get current authenticated user
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Current user }
 */
router.get("/me", requireAuth, asyncHandler(authController.me));

export default router;
