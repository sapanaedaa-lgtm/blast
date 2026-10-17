import { Request, Response } from "express";
import { env } from "@/config/env";
import { AppError } from "@/utils/AppError";
import { recordAudit } from "@/middleware/auditLog";
import * as authService from "./auth.service";

const REFRESH_COOKIE = "inaedaa.refresh";

// Frontend and API are on different sites, so production needs SameSite=None (+ Secure).
const refreshSameSite = env.NODE_ENV === "production" ? "none" : "strict";

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: refreshSameSite,
    path: "/api/v1/auth",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export async function register(req: Request, res: Response) {
  const user = await authService.registerUser(req.body);
  res.status(201).json({ success: true, data: user });
}

export async function login(req: Request, res: Response) {
  const { user, accessToken, refreshToken } = await authService.authenticate(req.body, {
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  });

  setRefreshCookie(res, refreshToken);
  await recordAudit({ userId: user.id, action: "LOGIN", req });

  res.json({ success: true, data: { user, accessToken } });
}

export async function refresh(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw AppError.unauthorized("Tidak ada sesi aktif");

  const { accessToken, user } = await authService.refreshSession(token);
  res.json({ success: true, data: { user, accessToken } });
}

export async function logout(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (token) await authService.revokeRefreshToken(token);
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: refreshSameSite,
    path: "/api/v1/auth",
  });

  if (req.user) await recordAudit({ userId: req.user.sub, action: "LOGOUT", req });

  res.json({ success: true, message: "Berhasil logout" });
}

export async function me(req: Request, res: Response) {
  res.json({ success: true, data: req.user });
}
