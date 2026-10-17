import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import dayjs from "dayjs";
import { prisma } from "@/config/prisma";
import { env } from "@/config/env";
import { AppError } from "@/utils/AppError";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "@/utils/jwt";
import { LoginInput, RegisterInput } from "./auth.schema";

const REFRESH_TTL_DAYS_DEFAULT = 7;
const REFRESH_TTL_DAYS_REMEMBER = 30;

export async function registerUser(input: RegisterInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw AppError.conflict("Email sudah terdaftar");

  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash,
      settings: {
        create: {
          defaultMinDelaySec: env.DEFAULT_MIN_DELAY_SEC,
          defaultMaxDelaySec: env.DEFAULT_MAX_DELAY_SEC,
          maxMessagesPerHour: env.MAX_MESSAGES_PER_HOUR,
          maxRetryAttempts: env.MAX_RETRY_ATTEMPTS,
          autoPauseFailureRate: env.AUTO_PAUSE_FAILURE_THRESHOLD,
        },
      },
    },
  });

  return sanitizeUser(user);
}

export async function authenticate(
  input: LoginInput,
  meta: { ip?: string; userAgent?: string }
) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || !user.isActive) throw AppError.unauthorized("Email atau password salah");

  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) throw AppError.unauthorized("Email atau password salah");

  const accessToken = signAccessToken({ sub: user.id, role: user.role, email: user.email });
  const ttlDays = input.rememberMe ? REFRESH_TTL_DAYS_REMEMBER : REFRESH_TTL_DAYS_DEFAULT;
  const refreshToken = signRefreshToken(user.id, `${ttlDays}d`);

  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt: dayjs().add(ttlDays, "day").toDate(),
      userAgent: meta.userAgent,
      ipAddress: meta.ip,
    },
  });

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  return { user: sanitizeUser(user), accessToken, refreshToken, rememberMe: !!input.rememberMe };
}

export async function refreshSession(refreshToken: string) {
  let payload: { sub: string };
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw AppError.unauthorized("Refresh token tidak valid");
  }

  const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });
  if (!stored || stored.revoked || stored.expiresAt < new Date()) {
    throw AppError.unauthorized("Sesi telah berakhir, silakan login kembali");
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) throw AppError.unauthorized();

  const accessToken = signAccessToken({ sub: user.id, role: user.role, email: user.email });
  return { accessToken, user: sanitizeUser(user) };
}

export async function revokeRefreshToken(token: string) {
  await prisma.refreshToken.updateMany({
    where: { token },
    data: { revoked: true },
  });
}

export function sanitizeUser<T extends { passwordHash?: string }>(user: T) {
  const { passwordHash, ...rest } = user;
  return rest;
}

export function generateSessionId() {
  return uuid();
}
