import "./polyfills";
import { createServer } from "http";
import { createApp } from "@/app";
import { env } from "@/config/env";
import { logger } from "@/config/logger";
import { prisma } from "@/config/prisma";
import { initSocket } from "@/sockets";
import { startCampaignWorker } from "@/modules/queue/campaign.worker";
import { whatsappEngine } from "@/modules/whatsapp/baileys.engine";

async function bootstrap() {
  const app = createApp();
  const httpServer = createServer(app);

  const io = initSocket(httpServer);
  app.set("io", io);
  whatsappEngine.attachSocketServer(io);

  // Start the BullMQ worker that actually sends queued messages.
  startCampaignWorker(io);

  await prisma.$connect();
  logger.info("✅ Database connected");

  httpServer.listen(env.PORT, () => {
    logger.info(`🚀 iNaedaa Blast API running on port ${env.PORT} [${env.NODE_ENV}]`);
    logger.info(`📚 Swagger docs available at http://localhost:${env.PORT}/api/docs`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received. Shutting down gracefully...`);
    httpServer.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

bootstrap().catch((err) => {
  logger.error({ err }, "Fatal error during bootstrap");
  process.exit(1);
});

