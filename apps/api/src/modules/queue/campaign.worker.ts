import { Worker, Job } from "bullmq";
import { Server as SocketIOServer } from "socket.io";
import { MessageStatus, CampaignStatus } from "@prisma/client";
import { redisConnection } from "@/config/redis";
import { prisma } from "@/config/prisma";
import { env } from "@/config/env";
import { logger } from "@/config/logger";
import { whatsappEngine } from "@/modules/whatsapp/baileys.engine";
import { emitCampaignProgress, emitNotification } from "@/sockets";
import { CAMPAIGN_QUEUE_NAME, CampaignJobData, enqueueMessage } from "./campaign.queue";

/** Exponential backoff: 30s, 60s, 120s... capped at 10 minutes. */
function backoffDelayMs(attempt: number): number {
  return Math.min(30_000 * 2 ** Math.max(attempt - 1, 0), 10 * 60_000);
}

export function startCampaignWorker(io: SocketIOServer) {
  const worker = new Worker<CampaignJobData>(
    CAMPAIGN_QUEUE_NAME,
    (job: Job<CampaignJobData>) => processJob(job, io),
    { connection: redisConnection, concurrency: env.QUEUE_CONCURRENCY }
  );

  worker.on("failed", (job, err) => {
    logger.error({ err, jobId: job?.id, data: job?.data }, "Campaign job failed permanently");
  });

  worker.on("error", (err) => logger.error({ err }, "Campaign worker error"));

  logger.info(`🧵 Campaign worker started (concurrency=${env.QUEUE_CONCURRENCY})`);
  return worker;
}

async function processJob(job: Job<CampaignJobData>, io: SocketIOServer) {
  const {
    campaignId,
    messageId,
    userId,
    phoneNumber,
    content,
    mediaPath,
    mediaType,
    attempt,
  } = job.data;

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return;

  // A paused campaign simply leaves this job's message PENDING; resuming re-enqueues it.
  if (campaign.status === CampaignStatus.PAUSED) return;

  if (campaign.status === CampaignStatus.CANCELLED) {
    await prisma.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.SKIPPED },
    });
    return;
  }

  await prisma.message.update({
    where: { id: messageId },
    data: { status: MessageStatus.SENDING, attempts: attempt },
  });

  const result = await whatsappEngine.sendMessage({
    userId,
    to: phoneNumber,
    text: content,
    mediaPath,
    mediaType,
  });

  if (result.success) {
    await prisma.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.SENT, waMessageId: result.waMessageId, sentAt: new Date() },
    });
    await prisma.campaign.update({ where: { id: campaignId }, data: { sentCount: { increment: 1 } } });
  } else {
    const willRetry = attempt < env.MAX_RETRY_ATTEMPTS;

    if (willRetry) {
      await prisma.message.update({
        where: { id: messageId },
        data: { status: MessageStatus.PENDING, errorMessage: result.error },
      });
      await enqueueMessage(
        {
          ...job.data,
          attempt: attempt + 1,
        },
        backoffDelayMs(attempt + 1)
      );
    } else {
      await prisma.message.update({
        where: { id: messageId },
        data: { status: MessageStatus.FAILED, errorMessage: result.error, failedAt: new Date() },
      });
      await prisma.campaign.update({ where: { id: campaignId }, data: { failedCount: { increment: 1 } } });
    }
  }

  await evaluateCampaignProgress(campaignId, io);
}

/**
 * Recomputes progress, broadcasts a realtime update, and applies safety
 * mechanisms: marks the campaign COMPLETED once every message is resolved,
 * and auto-pauses it if the failure rate crosses the configured threshold
 * (once a minimum sample size has been processed) to protect the account
 * from further risk.
 */
export async function evaluateCampaignProgress(campaignId: string, io: SocketIOServer) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return;

  const processed = campaign.sentCount + campaign.failedCount + campaign.skippedCount;
  const total = campaign.totalContacts;
  const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;
  const failureRate = processed > 0 ? campaign.failedCount / processed : 0;

  let nextStatus: CampaignStatus | undefined;
  let notify: { type: "success" | "warning" | "error"; title: string; message: string } | undefined;

  if (processed >= total && total > 0 && campaign.status === CampaignStatus.RUNNING) {
    nextStatus = CampaignStatus.COMPLETED;
    notify = {
      type: "success",
      title: "Campaign Selesai",
      message: `${campaign.name} selesai: ${campaign.sentCount} berhasil, ${campaign.failedCount} gagal.`,
    };
  } else if (
    campaign.status === CampaignStatus.RUNNING &&
    processed >= env.AUTO_PAUSE_MIN_SAMPLE &&
    failureRate >= env.AUTO_PAUSE_FAILURE_THRESHOLD
  ) {
    nextStatus = CampaignStatus.PAUSED;
    notify = {
      type: "warning",
      title: "Campaign Dijeda Otomatis",
      message: `Tingkat kegagalan ${(failureRate * 100).toFixed(0)}% melebihi ambang batas. Campaign "${campaign.name}" dijeda demi keamanan akun.`,
    };
  }

  if (nextStatus) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: nextStatus,
        finishedAt: nextStatus === CampaignStatus.COMPLETED ? new Date() : undefined,
        pausedAt: nextStatus === CampaignStatus.PAUSED ? new Date() : undefined,
      },
    });
  }

  emitCampaignProgress(io, campaignId, {
    campaignId,
    status: nextStatus ?? campaign.status,
    totalContacts: total,
    sentCount: campaign.sentCount,
    failedCount: campaign.failedCount,
    skippedCount: campaign.skippedCount,
    processed,
    percentage,
    failureRate: Number(failureRate.toFixed(3)),
  });

  if (notify) emitNotification(io, campaign.userId, notify);
}

