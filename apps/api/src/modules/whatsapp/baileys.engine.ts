import path from "path";
import fs from "fs";
import qrcode from "qrcode";
import makeWASocket, {
  DisconnectReason,
  WASocket,
  Browsers,
  ConnectionState,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
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
const RESTART_READY_TIMEOUT_MS = 60000;
const RESTART_POLL_INTERVAL_MS = 1000;
const INVALID_SIGNATURE_MESSAGE = "Invalid account signature";

function isInvalidSignatureError(reason: string): boolean {
  return reason.toLowerCase().includes(INVALID_SIGNATURE_MESSAGE.toLowerCase());
}

function isStuckSocketError(errMsg: string, statusCode?: number): boolean {
  if (statusCode === 408 || statusCode === 428) return true;
  return /timed out|timeout|init queries|connection closed|connection failure/i.test(errMsg);
}

class BaileysWhatsAppEngine implements IWhatsAppEngine {
  private sessions = new Map<string, ActiveSession>();
  private restarting = new Map<string, Promise<boolean>>();
  private reconnectAttempts = new Map<string, number>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private loggingOut = new Set<string>();
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
    if (isAutoReconnect && this.loggingOut.has(userId)) {
      return;
    }

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

    let waVersion: [number, number, number] | undefined;
    try {
      const latest = await fetchLatestBaileysVersion();
      if (latest.error) {
        logger.warn(
          { err: latest.error },
          "Failed to fetch latest WhatsApp Web version, using Baileys default",
        );
      } else {
        waVersion = latest.version;
        logger.info(
          { isLatest: latest.isLatest, version: latest.version.join(".") },
          "Resolved WhatsApp Web version",
        );
      }
    } catch (err) {
      logger.warn({ err }, "Failed to fetch latest WhatsApp Web version, using Baileys default");
    }

    const socket = makeWASocket({
      version: waVersion,
      auth: state,
      browser: Browsers.appropriate("Chrome"),
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    this.sessions.set(userId, { socket, status: "CONNECTING", startedAt: Date.now() });
    await this.persistStatus(userId, "CONNECTING");

    socket.ev.on("creds.update", saveCreds);
    socket.ev.on("connection.update", (update) => {
      this.handleConnectionUpdate(userId, update, socket).catch((err) =>
        logger.error({ err, userId }, "Error handling WA connection update")
      );
    });
  }

  private async handleConnectionUpdate(
    userId: string,
    update: Partial<ConnectionState>,
    socket: WASocket,
  ) {
    const { connection, lastDisconnect, qr } = update;
    const session = this.sessions.get(userId);
    if (session && session.socket !== socket) {
      return; // stale event from a replaced socket
    }

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

      logger.warn(
        { userId, statusCode, reason, loggedOut },
        `Baileys connection closed: statusCode=${statusCode ?? "none"} loggedOut=${loggedOut} reason=${reason}`,
      );

      this.sessions.delete(userId);

      if (!loggedOut && isInvalidSignatureError(reason)) {
        // Stop any pending reconnect and reset counters.
        const timer = this.reconnectTimers.get(userId);
        if (timer) {
          clearTimeout(timer);
          this.reconnectTimers.delete(userId);
        }
        this.reconnectAttempts.delete(userId);

        logger.error(
          { userId, statusCode, reason },
          "Pairing ditolak WhatsApp: Invalid account signature. Sesi lokal dihapus, auto-reconnect dihentikan.",
        );

        try {
          await wipeAuthState(this.sessionFolder(userId));
        } catch (err) {
          logger.error({ err, userId }, "Failed to wipe WhatsApp session files after invalid signature");
        }

        try {
          await this.persistStatus(userId, "DISCONNECTED", {
            disconnectReason: "invalid_account_signature",
            phoneNumber: null,
            profileName: null,
          });
        } catch (err) {
          logger.error({ err, userId }, "Failed to persist WhatsApp status after invalid signature");
        }

        this.broadcastStatus(userId, { status: "DISCONNECTED" });
        this.notify(
          userId,
          "error",
          "Pairing WhatsApp Gagal",
          "WhatsApp menolak perangkat ini (Invalid account signature). Periksa menu Perangkat Tertaut di HP: hapus perangkat lama atau yang tidak dikenal, lalu klik Hubungkan WhatsApp dan pindai QR Code terbaru.",
        );
        return;
      }

      await this.persistStatus(userId, loggedOut ? "LOGGED_OUT" : "DISCONNECTED", {
        disconnectReason: reason,
      });
      this.broadcastStatus(userId, { status: loggedOut ? "LOGGED_OUT" : "DISCONNECTED" });

      if (loggedOut) {
        this.reconnectAttempts.delete(userId);
        await wipeAuthState(this.sessionFolder(userId));
        this.notify(userId, "error", "WhatsApp Logout", "Perangkat logout. Silakan pindai ulang QR Code.");
      } else {
        if (this.loggingOut.has(userId)) {
          return; // logout flow handles cleanup; do not schedule a reconnect
        }

        const attempts = (this.reconnectAttempts.get(userId) ?? 0) + 1;
        this.reconnectAttempts.set(userId, attempts);

        if (attempts > MAX_RECONNECT_ATTEMPTS) {
          logger.error(
            { userId, attempts, statusCode, reason },
            `Baileys reconnect limit reached: statusCode=${statusCode ?? "none"} reason=${reason} attempts=${attempts}`,
          );
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
        const existingTimer = this.reconnectTimers.get(userId);
        if (existingTimer) clearTimeout(existingTimer);
        const t = setTimeout(() => {
          this.reconnectTimers.delete(userId);
          this.startSession(userId, true).catch((err) =>
            logger.error({ err, userId }, "Auto-reconnect failed")
          );
        }, RECONNECT_DELAY_MS);
        this.reconnectTimers.set(userId, t);
      }
    }
  }

  async logoutSession(userId: string): Promise<void> {
    this.loggingOut.add(userId);
    try {
      const timer = this.reconnectTimers.get(userId);
      if (timer) {
        clearTimeout(timer);
        this.reconnectTimers.delete(userId);
      }
      this.reconnectAttempts.delete(userId);

      const session = this.sessions.get(userId);
      if (session) {
        try {
          session.socket.ev.removeAllListeners("creds.update");
          session.socket.ev.removeAllListeners("connection.update");
        } catch (err) {
          logger.warn({ err, userId }, "Error removing WhatsApp socket listeners during logout");
        }
        try {
          await session.socket.logout();
        } catch (err) {
          logger.warn({ err, userId }, "Error during explicit WA logout, forcing local cleanup");
        }
        try {
          session.socket.end(undefined);
        } catch (err) {
          logger.warn({ err, userId }, "Error closing WhatsApp socket during logout");
        }
        this.sessions.delete(userId);
      }

      this.restarting.delete(userId);

      try {
        await wipeAuthState(this.sessionFolder(userId));
      } catch (err) {
        logger.error({ err, userId }, "Failed to wipe WhatsApp session files during logout");
      }

      try {
        await this.persistStatus(userId, "DISCONNECTED", {
          disconnectReason: "user_logout",
          phoneNumber: null,
          profileName: null,
          lastQrAt: null,
        });
      } catch (err) {
        logger.error({ err, userId }, "Failed to persist WhatsApp status during logout");
      }

      this.broadcastStatus(userId, { status: "DISCONNECTED" });
    } catch (err) {
      logger.error({ err, userId }, "Unexpected error during WhatsApp logout");
    } finally {
      this.loggingOut.delete(userId);
    }
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
      const errMsg = err instanceof Error ? err.message : String(err);
      const statusCode = (err as Boom | undefined)?.output?.statusCode;
      logger.error(
        { err, userId: input.userId, statusCode, errMsg },
        `Failed to send WhatsApp message: statusCode=${statusCode ?? "none"} error=${errMsg}`,
      );

      if (isStuckSocketError(errMsg, statusCode)) {
        await this.restartSession(input.userId);
      }

      return { success: false, error: errMsg };
    }
  }

  private async restartSession(userId: string): Promise<boolean> {
    const inProgress = this.restarting.get(userId);
    if (inProgress) return inProgress;

    const promise = (async (): Promise<boolean> => {
      logger.warn({ userId }, "Restarting WhatsApp socket after send failure");

      try {
        this.sessions.get(userId)?.socket.end(undefined);
      } catch (err) {
        logger.warn({ err, userId }, "Error closing WhatsApp socket during restart");
      }
      this.sessions.delete(userId);
      this.reconnectAttempts.set(userId, 0);

      try {
        await this.startSession(userId, true);
      } catch (err) {
        logger.error({ err, userId }, "Failed to restart WhatsApp socket");
        return false;
      }

      const deadline = Date.now() + RESTART_READY_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (this.sessions.get(userId)?.status === "CONNECTED") {
          logger.info({ userId }, "WhatsApp socket restarted and connected");
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, RESTART_POLL_INTERVAL_MS));
      }

      if (this.sessions.get(userId)?.status === "CONNECTED") {
        logger.info({ userId }, "WhatsApp socket restarted and connected");
        return true;
      }
      logger.warn({ userId }, "WhatsApp socket not ready after restart");
      return false;
    })().finally(() => {
      this.restarting.delete(userId);
    });

    this.restarting.set(userId, promise);
    return promise;
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
