/**
 * Seed script — creates a default admin user and sensible default settings.
 * Run with: npm run prisma:seed -w apps/api
 */
import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || "admin@inaedaa.local";
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < 12) {
    console.error("SEED_ADMIN_PASSWORD wajib diset (minimal 12 karakter). Seed dibatalkan.");
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      name: "Administrator",
      email,
      passwordHash,
      role: Role.ADMIN,
      settings: {
        create: {
          defaultMinDelaySec: 5,
          defaultMaxDelaySec: 15,
          maxMessagesPerHour: 120,
          maxRetryAttempts: 3,
          autoPauseFailureRate: 0.4,
        },
      },
    },
  });

  const templates = [
    {
      name: "Promo Bulanan",
      category: "PROMOSI" as const,
      content:
        "Halo {nama} 👋, ada promo spesial untuk Anda hari ini ({tanggal})! Jangan sampai terlewat ya.",
      variables: ["nama", "tanggal"],
    },
    {
      name: "Pengingat Tagihan",
      category: "TAGIHAN" as const,
      content:
        "Halo {nama}, ini pengingat bahwa tagihan Anda dengan nomor {nomor} akan jatuh tempo pada {tanggal}. Terima kasih.",
      variables: ["nama", "nomor", "tanggal"],
    },
    {
      name: "Follow Up Customer",
      category: "FOLLOW_UP" as const,
      content:
        "Halo {nama}, kami ingin menindaklanjuti percakapan sebelumnya. Apakah ada yang bisa kami bantu?",
      variables: ["nama"],
    },
  ];

  for (const t of templates) {
    const exists = await prisma.template.findFirst({
      where: { userId: admin.id, name: t.name },
    });
    if (!exists) {
      await prisma.template.create({ data: { ...t, userId: admin.id } });
    }
  }

  console.log("✅ Seed complete.");
  console.log(`   Admin email: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
