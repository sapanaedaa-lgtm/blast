import { Request, Response } from "express";
import { recordAudit } from "@/middleware/auditLog";
import * as whatsappService from "./whatsapp.service";

export async function connect(req: Request, res: Response) {
  const userId = req.user!.sub;
  const result = await whatsappService.requestConnection(userId);
  await recordAudit({ userId, action: "WHATSAPP_CONNECT", req });
  res.json({
    success: true,
    data: result,
    message: "Permintaan koneksi WhatsApp diproses. Pindai QR Code jika diminta.",
  });
}

export async function status(req: Request, res: Response) {
  const result = await whatsappService.getSessionStatus(req.user!.sub);
  res.json({ success: true, data: result });
}

export async function logout(req: Request, res: Response) {
  const userId = req.user!.sub;
  const result = await whatsappService.disconnectSession(userId);
  await recordAudit({ userId, action: "WHATSAPP_DISCONNECT", req });
  res.json({
    success: true,
    data: result,
    message: "Session status diperbarui.",
  });
}

