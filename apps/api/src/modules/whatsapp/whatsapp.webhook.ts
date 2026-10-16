import { Request, Response } from "express";
import { env } from "@/config/env";
import { logger } from "@/config/logger";
// Cloud API engine is only used here, to process Meta webhook payloads when configured.
import { whatsappEngine as cloudApiEngine } from "./cloudapi.engine";

/**
 * GET /api/v1/whatsapp/webhook
 * Webhook verification endpoint from Meta (Facebook/WhatsApp).
 * Meta sends: hub.mode=subscribe, hub.verify_token=..., hub.challenge=...
 * We verify the token and echo back the challenge.
 */
export async function verifyWebhook(req: Request, res: Response) {
  // Cloud API is optional; without a configured verify token the webhook is disabled.
  if (!env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return res.status(404).json({ error: "WhatsApp Cloud API webhook is not enabled" });
  }

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  logger.info({ mode, token: token ? "***" : undefined, challenge: challenge ? "***" : undefined }, "Webhook verification request");

  if (mode !== "subscribe") {
    return res.status(400).json({ error: "Invalid mode" });
  }

  if (token !== env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    logger.warn({ receivedToken: "***" }, "Webhook verification failed: invalid token");
    return res.status(403).json({ error: "Invalid verification token" });
  }

  logger.info("Webhook verified successfully");
  res.status(200).send(challenge);
}

/**
 * POST /api/v1/whatsapp/webhook
 * Receive messages, status updates, and other events from Meta.
 * Always respond 200 quickly, then process asynchronously if needed.
 */
export async function handleWebhook(req: Request, res: Response) {
  // Cloud API is optional; acknowledge and ignore events when it is not configured.
  if (!env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).json({ success: true, ignored: true });
  }

  try {
    const payload = req.body;

    logger.debug({ payload }, "Received webhook payload");

    // Respond immediately (Meta expects within 3 seconds)
    res.status(200).json({ success: true });

    // Process asynchronously in background
    if (payload.object === "whatsapp_business_account") {
      cloudApiEngine.handleWebhookEvent(payload).catch((err) => {
        logger.error({ err, payload }, "Error handling webhook event");
      });
    } else {
      logger.warn({ object: payload.object }, "Webhook payload is not whatsapp_business_account");
    }
  } catch (err) {
    logger.error({ err }, "Unexpected error in webhook handler");
    // Still return 200 to prevent Meta retries
    res.status(200).json({ success: false, error: "Processing error" });
  }
}

