import { CampaignStatus, MessageStatus } from "@prisma/client";
import { prisma } from "@/config/prisma";
import { AppError } from "@/utils/AppError";
import { renderTemplate } from "@/modules/template/template.service";
import { whatsappEngine } from "@/modules/whatsapp/baileys.engine";
import { enqueueMessage, drainCampaignJobs } from "@/modules/queue/campaign.queue";
import { buildDelaySchedule, DELAY_PRESET_RANGES } from "@/modules/queue/scheduler";
import { CreateCampaignInput } from "./campaign.schema";
import dayjs from "dayjs";
import path from "path";
import { env } from "@/config/env";

function resolveDelayRange(input: CreateCampaignInput): { min: number; max: number } {
  if (input.delayPreset === "CUSTOM") {
    return { min: input.minDelaySec!, max: input.maxDelaySec! };
  }
  return DELAY_PRESET_RANGES[input.delayPreset];
}

export async function createCampaign(userId: string, input: CreateCampaignInput) {
  const contactList = await prisma.contactList.findFirst({
    where: { id: input.contactListId, userId },
    include: { contacts: true },
  });
  if (!contactList) throw AppError.notFound("Daftar kontak tidak ditemukan");
  if (contactList.contacts.length === 0) throw AppError.badRequest("Daftar kontak kosong");

  const { min, max } = resolveDelayRange(input);

  const whatsappSession = await prisma.whatsAppSession.findUnique({
    where: { userId_sessionName: { userId, sessionName: "default" } },
  });

  const campaign = await prisma.campaign.create({
    data: {
      userId,
      whatsappSessionId: whatsappSession?.id,
      contactListId: contactList.id,
      templateId: input.templateId,
      mediaFileId: input.mediaFileId,
      name: input.name,
      messageBody: input.messageBody,
      delayPreset: input.delayPreset,
      minDelaySec: min,
      maxDelaySec: max,
      maxPerHour: input.maxPerHour,
      totalContacts: contactList.contacts.length,
      status: CampaignStatus.DRAFT,
      messages: {
        create: contactList.contacts.map((contact) => ({
          contactId: contact.id,
          phoneNumber: contact.phoneNumber,
          content: renderTemplate(input.messageBody, {
            nama: contact.name ?? "Pelanggan",
            nomor: contact.phoneNumber,
            tanggal: dayjs().format("DD/MM/YYYY"),
          }),
          status: MessageStatus.PENDING,
        })),
      },
    },
  });

  return campaign;
}

export async function listCampaigns(
  userId: string,
  filters: { status?: string; search?: string; page: number; limit: number }
) {
  const where = {
    userId,
    ...(filters.status ? { status: filters.status as CampaignStatus } : {}),
    ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" as const } } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.campaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
      include: { contactList: { select: { name: true } }, mediaFile: true, template: { select: { name: true } } },
    }),
    prisma.campaign.count({ where }),
  ]);

  return { items, total, page: filters.page, limit: filters.limit, totalPages: Math.ceil(total / filters.limit) };
}

export async function getCampaign(userId: string, id: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id, userId },
    include: {
      contactList: { select: { id: true, name: true } },
      mediaFile: true,
      template: { select: { id: true, name: true } },
      whatsappSession: { select: { phoneNumber: true, profileName: true, status: true } },
    },
  });
  if (!campaign) throw AppError.notFound("Campaign tidak ditemukan");
  return campaign;
}

async function assertWhatsAppConnected(userId: string) {
  if (!whatsappEngine.isConnected(userId)) {
    throw AppError.badRequest(
      "WhatsApp belum tersambung. Silakan pindai QR Code di halaman koneksi WhatsApp terlebih dahulu."
    );
  }
}

export async function startCampaign(userId: string, id: string) {
  const campaign = await getCampaign(userId, id);
  const startableStatuses: CampaignStatus[] = [CampaignStatus.DRAFT, CampaignStatus.PAUSED];
  if (!startableStatuses.includes(campaign.status)) {
    throw AppError.badRequest(`Campaign berstatus ${campaign.status}, tidak dapat dimulai`);
  }

  await assertWhatsAppConnected(userId);

  const pendingMessages = await prisma.message.findMany({
    where: { campaignId: id, status: MessageStatus.PENDING },
    orderBy: { createdAt: "asc" },
  });

  if (pendingMessages.length === 0) {
    throw AppError.badRequest("Tidak ada pesan tersisa untuk dikirim pada campaign ini");
  }

  const schedule = buildDelaySchedule(
    pendingMessages.length,
    campaign.minDelaySec,
    campaign.maxDelaySec,
    campaign.maxPerHour
  );

  const mediaPath = campaign.mediaFile
    ? path.resolve(env.UPLOAD_DIR, path.basename(campaign.mediaFile.path))
    : undefined;
  const mediaType =
    campaign.mediaFile && campaign.mediaFile.type !== "NONE" ? campaign.mediaFile.type : undefined;

  // Baileys sends the rendered message content as free text; no Cloud API templates.
  await Promise.all(
    pendingMessages.map((message, idx) =>
      enqueueMessage(
        {
          campaignId: id,
          messageId: message.id,
          userId,
          phoneNumber: message.phoneNumber,
          content: message.content,
          mediaPath: mediaPath as string | undefined,
          mediaType: mediaType as "IMAGE" | "VIDEO" | "DOCUMENT" | undefined,
          attempt: message.attempts + 1,
        },
        schedule[idx]
      )
    )
  );

  const estimatedFinishAt = new Date(Date.now() + schedule[schedule.length - 1]);

  return prisma.campaign.update({
    where: { id },
    data: {
      status: CampaignStatus.RUNNING,
      startedAt: campaign.startedAt ?? new Date(),
      pausedAt: null,
      estimatedFinishAt,
    },
  });
}

export async function pauseCampaign(userId: string, id: string) {
  const campaign = await getCampaign(userId, id);
  if (campaign.status !== CampaignStatus.RUNNING) {
    throw AppError.badRequest("Hanya campaign yang sedang berjalan yang dapat dijeda");
  }

  await prisma.campaign.update({ where: { id }, data: { status: CampaignStatus.PAUSED, pausedAt: new Date() } });
  await drainCampaignJobs(id);

  return getCampaign(userId, id);
}

export async function cancelCampaign(userId: string, id: string) {
  const campaign = await getCampaign(userId, id);
  const cancellableStatuses: CampaignStatus[] = [
    CampaignStatus.RUNNING,
    CampaignStatus.PAUSED,
    CampaignStatus.QUEUED,
  ];
  if (!cancellableStatuses.includes(campaign.status)) {
    throw AppError.badRequest("Campaign tidak dapat dibatalkan pada status ini");
  }

  await prisma.campaign.update({ where: { id }, data: { status: CampaignStatus.CANCELLED, finishedAt: new Date() } });
  await drainCampaignJobs(id);
  const result = await prisma.message.updateMany({
    where: { campaignId: id, status: { in: [MessageStatus.PENDING, MessageStatus.SENDING] } },
    data: { status: MessageStatus.SKIPPED },
  });
  await prisma.campaign.update({ where: { id }, data: { skippedCount: { increment: result.count } } });

  return getCampaign(userId, id);
}

export async function getCampaignProgress(userId: string, id: string) {
  const campaign = await getCampaign(userId, id);
  const processed = campaign.sentCount + campaign.failedCount + campaign.skippedCount;
  const percentage = campaign.totalContacts > 0 ? Math.round((processed / campaign.totalContacts) * 100) : 0;

  return {
    campaignId: id,
    status: campaign.status,
    totalContacts: campaign.totalContacts,
    sentCount: campaign.sentCount,
    failedCount: campaign.failedCount,
    skippedCount: campaign.skippedCount,
    processed,
    percentage,
    estimatedFinishAt: campaign.estimatedFinishAt,
  };
}

