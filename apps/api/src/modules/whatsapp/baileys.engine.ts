import path from "path";
import fs from "fs";
import qrcode from "qrcode";
import makeWASocket, {
  DisconnectReason,
  WASocket,
  Browsers,
  ConnectionState,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";
import type { Boom } from "@hapi/boom";
import { Server as SocketIOServer } from "socket.io";
import { env } from "@/config/env";
import { logger } from "@/config/logger";
import { prisma } from "@/config/prisma";
import { useEncryptedAuthState, wipeAuthState } from "./authState";
import { emitWhatsAppStatus, emitNotification } from "@/sockets";
import {
  IWhatsAppEngine,
  SendMessageInput,
  SendMessageResult,
  WhatsAppStatusPayload,
} from "./whatsapp.types";

interface ActiveSession {
  socket: WASocket;
  status: WhatsAppStatusPayload["status"];
  startedAt: number;
}

const STALE_SESSION_MS = 120000;
const RECONNECT_DELAY_MS = 4000;
const MAX_RECONNECT_ATTEMPTS = 5;

class BaileysWhatsAppEngine implements IWhatsAppEngine {
  private sessions = new Map<string, ActiveSession>();
  private reconnectAttempts = new Map<string, number>();
  private io?: SocketIOServer;

  attachSocketServer(io: SocketIOServer) {
    this.io = io;
  }

  /**
   * At process start the in-memory `sessions` map is empty, so any persisted
   * status other than DISCONNECTED/LOGGED_OUT is stale and must be reset.
   */
  async resetStaleSessions(): Promise<void> {
    const result = await prisma.whatsAppSession.updateMany({
      where: { status: { in: ["CONNECTING", "QR_PENDING", "RECONNECTING", "CONNECTED"] } },
      data: { status: "DISCONNECTED", disconnectReason: "server_restart" },
    });
    logger.info({ count: result.count }, "Reset stale WhatsApp sessions");
  }

  isConnected(userId: string): boolean {
    return this.sessions.get(userId)?.status === "CONNECTED";
  }

  getActiveSocket(userId: string): WASocket | undefined {
    const session = this.sessions.get(userId);
    return session?.status === "CONNECTED" ? session.socket : undefined;
  }

  private sessionFolder(userId: string) {
    return path.resolve(env.WA_SESSION_DIR, userId);
  }

  async startSession(userId: string, isAutoReconnect = false): Promise<void> {
    const existing = this.sessions.get(userId);
    if (existing) {
      if (existing.status === "CONNECTED") {
        return; // already connected — no-op
      }
      const isPending = existing.status === "CONNECTING" || existing.status === "QR_PENDING";
      if (isPending && Date.now() - existing.startedAt < STALE_SESSION_MS) {
        return; // recently started — no-op
      }
      if (isPending) {
        logger.warn({ userId }, "Restarting stale WhatsApp session");
        try {
          existing.socket.end(undefined);
        } catch (err) {
          logger.warn({ err, userId }, "Error closing stale WhatsApp socket");
        }
        this.sessions.delete(userId);
      }
    }

    if (!isAutoReconnect) {
      this.reconnectAttempts.set(userId, 0);
    }

    const folder = this.sessionFolder(userId);
    const { state, saveCreds } = await useEncryptedAuthState(folder);

    const socket = makeWASocket({
      auth: state,
      browser: Browsers.appropriate("Chrome"),
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    this.sessions.set(userId, { socket, status: "CONNECTING", startedAt: Date.now() });
    await this.persistStatus(userId, "CONNECTING");

    socket.ev.on("creds.update", saveCreds);
    socket.ev.on("connection.update", (update) => {
      this.handleConnectionUpdate(userId, update).catch((err) =>
        logger.error({ err, userId }, "Error handling WA connection update")
      );
    });
  }

  private async handleConnectionUpdate(userId: string, update: Partial<ConnectionState>) {
    const { connection, lastDisconnect, qr } = update;
    const session = this.sessions.get(userId);

    if (qr) {
      logger.info({ userId, qrReceived: true }, "Baileys QR generated");
      const qrDataUrl = await qrcode.toDataURL(qr, { margin: 1, width: 320 });
      if (session) session.status = "QR_PENDING";
      await this.persistStatus(userId, "QR_PENDING", { lastQrAt: new Date() });
      this.broadcastStatus(userId, { status: "QR_PENDING", qr: qrDataUrl });
    }

    if (connection === "open") {
      logger.info({ userId }, "Baileys connection open");
      this.reconnectAttempts.set(userId, 0);
      const me = session?.socket.user;
      const phoneNumber = me?.id?.split(":")[0]?.split("@")[0];
      if (session) session.status = "CONNECTED";

      await this.persistStatus(userId, "CONNECTED", {
        phoneNumber,
        profileName: me?.name ?? undefined,
        lastConnectedAt: new Date(),
        disconnectReason: null,
      });
      this.broadcastStatus(userId, { status: "CONNECTED", phoneNumber, profileName: me?.name });
      this.notify(userId, "success", "WhatsApp Terhubung", `Nomor ${phoneNumber ?? ""} berhasil tersambung.`);
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      const reason = lastDisconnect?.error?.message ?? "unknown";

      logger.warn({ userId, statusCode, reason, loggedOut }, "Baileys connection closed");

      this.sessions.delete(userId);

      await this.persistStatus(userId, loggedOut ? "LOGGED_OUT" : "DISCONNECTED", {
        disconnectReason: reason,
      });
      this.broadcastStatus(userId, { status: loggedOut ? "LOGGED_OUT" : "DISCONNECTED" });

      if (loggedOut) {
        this.reconnectAttempts.delete(userId);
        await wipeAuthState(this.sessionFolder(userId));
        this.notify(userId, "error", "WhatsApp Logout", "Perangkat logout. Silakan pindai ulang QR Code.");
      } else {
        const attempts = (this.reconnectAttempts.get(userId) ?? 0) + 1;
        this.reconnectAttempts.set(userId, attempts);

        if (attempts > MAX_RECONNECT_ATTEMPTS) {
          logger.error({ userId, attempts, statusCode, reason }, "Baileys reconnect limit reached");
          await this.persistStatus(userId, "DISCONNECTED", {
            disconnectReason: `reconnect_limit_reached: ${reason}`,
          });
          this.broadcastStatus(userId, { status: "DISCONNECTED" });
          this.notify(
            userId,
            "error",
            "WhatsApp Gagal Tersambung",
            "Gagal menyambung ulang setelah beberapa kali percobaan. Klik Hubungkan WhatsApp untuk mencoba lagi."
          );
          this.reconnectAttempts.delete(userId);
          return;
        }

        this.notify(userId, "warning", "WhatsApp Terputus", "Koneksi terputus, mencoba menyambung ulang...");
        setTimeout(() => {
          this.startSession(userId, true).catch((err) =>
            logger.error({ err, userId }, "Auto-reconnect failed")
          );
        }, RECONNECT_DELAY_MS);
      }
    }
  }

  async logoutSession(userId: string): Promise<void> {
    const session = this.sessions.get(userId);
    if (session) {
      try {
        await session.socket.logout();
      } catch (err) {
        logger.warn({ err, userId }, "Error during explicit WA logout, forcing local cleanup");
      }
      this.sessions.delete(userId);
    }
    await wipeAuthState(this.sessionFolder(userId));
    await this.persistStatus(userId, "DISCONNECTED", { disconnectReason: "user_logout" });
    this.broadcastStatus(userId, { status: "DISCONNECTED" });
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const socket = this.getActiveSocket(input.userId);
    if (!socket) {
      return { success: false, error: "WhatsApp tidak terhubung untuk user ini" };
    }

    const jid = `${input.to}@s.whatsapp.net`;

    try {
      let result;
      if (input.mediaPath && input.mediaType) {
        const buffer = await fs.promises.readFile(input.mediaPath);
        if (input.mediaType === "IMAGE") {
          result = await socket.sendMessage(jid, { image: buffer, caption: input.caption ?? input.text });
        } else if (input.mediaType === "VIDEO") {
          result = await socket.sendMessage(jid, { video: buffer, caption: input.caption ?? input.text });
        } else {
          result = await socket.sendMessage(jid, {
            document: buffer,
            mimetype: "application/octet-stream",
            fileName: path.basename(input.mediaPath),
            caption: input.caption ?? input.text,
          });
        }
      } else {
        result = await socket.sendMessage(jid, { text: input.text ?? "" });
      }

      return { success: true, waMessageId: result?.key?.id ?? undefined };
    } catch (err) {
      logger.error({ err, userId: input.userId, to: input.to }, "Failed to send WhatsApp message");
      return { success: false, error: err instanceof Error ? err.message : "Unknown send error" };
    }
  }

  private async persistStatus(
    userId: string,
    status: WhatsAppStatusPayload["status"],
    extra: Record<string, unknown> = {}
  ) {
    await prisma.whatsAppSession.upsert({
      where: { userId_sessionName: { userId, sessionName: "default" } },
      update: { status, ...extra },
      create: { userId, sessionName: "default", status, ...extra },
    });
  }

  private broadcastStatus(userId: string, payload: WhatsAppStatusPayload) {
    if (this.io) emitWhatsAppStatus(this.io, userId, payload);
  }

  private notify(
    userId: string,
    type: "success" | "error" | "warning" | "info",
    title: string,
    message: string
  ) {
    if (this.io) emitNotification(this.io, userId, { type, title, message });
  }
}

/** Singleton instance shared across the app (controllers, queue worker). */
export const whatsappEngine = new BaileysWhatsAppEngine();

// Re-exported for modules that only need type-checked access to raw media download,
// used by potential future inbound-message features.
export { downloadMediaMessage };
