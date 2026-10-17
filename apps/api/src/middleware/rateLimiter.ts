import rateLimit from "express-rate-limit";
import { env } from "@/config/env";

export const globalRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Terlalu banyak permintaan, silakan coba lagi beberapa saat lagi.",
  },
});

// Stricter limiter for auth endpoints to slow down brute-force attempts.
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: "Terlalu banyak percobaan login. Coba lagi dalam 15 menit.",
  },
});

// Limiter for QR/session generation, keyed per authenticated user so retries
// while a session is connecting do not get throttled by shared IPs.
export const whatsappActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user!.sub,
  message: {
    success: false,
    message: "Terlalu banyak permintaan koneksi WhatsApp. Tunggu sebentar.",
  },
});
