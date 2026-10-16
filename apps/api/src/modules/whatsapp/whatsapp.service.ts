import { prisma } from "@/config/prisma";
import { whatsappEngine } from "./baileys.engine";
import { AppError } from "@/utils/AppError";

export async function requestConnection(userId: string) {
  await whatsappEngine.startSession(userId);
  return getSessionStatus(userId);
}

export async function getSessionStatus(userId: string) {
  const session = await prisma.whatsAppSession.findUnique({
    where: { userId_sessionName: { userId, sessionName: "default" } },
  });

  if (!session) {
    return { status: "DISCONNECTED" as const };
  }

  return {
    status: session.status,
    phoneNumber: session.phoneNumber,
    profileName: session.profileName,
    profilePicUrl: session.profilePicUrl,
    batteryLevel: session.batteryLevel,
    lastConnectedAt: session.lastConnectedAt,
    lastSeenAt: session.lastSeenAt,
  };
}

export async function disconnectSession(userId: string) {
  const session = await prisma.whatsAppSession.findUnique({
    where: { userId_sessionName: { userId, sessionName: "default" } },
  });
  if (!session) throw AppError.notFound("Sesi WhatsApp tidak ditemukan");

  await whatsappEngine.logoutSession(userId);
  return { success: true };
}

