"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Users, Image as ImageIcon, MessageSquare, Clock, Check, FileText } from "lucide-react";
import toast from "react-hot-toast";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { MessageEditor } from "@/components/campaign/MessageEditor";
import { DelaySelector } from "@/components/campaign/DelaySelector";
import { AuthImage } from "@/components/ui/AuthImage";
import { apiClient, apiErrorMessage } from "@/lib/apiClient";
import { cn } from "@/lib/utils";

interface ContactListItem {
  id: string;
  name: string;
  totalCount: number;
}
interface TemplateItem {
  id: string;
  name: string;
  content: string;
  category: string;
}
interface MediaItem {
  id: string;
  originalName: string;
  type: string;
  path: string;
  thumbnailPath: string | null;
}

export default function NewCampaignPage() {
  const router = useRouter();

  const [contactLists, setContactLists] = useState<ContactListItem[]>([]);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);

  const [name, setName] = useState("");
  const [contactListId, setContactListId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [mediaFileId, setMediaFileId] = useState("");
  const [messageBody, setMessageBody] = useState("");

  const [delayPreset, setDelayPreset] = useState("RANGE_5_10");
  const [minDelay, setMinDelay] = useState(5);
  const [maxDelay, setMaxDelay] = useState(10);
  const [maxPerHour, setMaxPerHour] = useState(120);

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiClient.get("/contacts", { params: { limit: 100 } }).then((r) => setContactLists(r.data.data.items));
    apiClient.get("/templates").then((r) => setTemplates(r.data.data));
    apiClient.get("/media", { params: { limit: 60 } }).then((r) => setMediaItems(r.data.data.items));
  }, []);

  function applyTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) setMessageBody(t.content);
  }

  const selectedContactList = contactLists.find((c) => c.id === contactListId);

  async function handleSubmit() {
    if (!name.trim()) return toast.error("Nama campaign wajib diisi");
    if (!contactListId) return toast.error("Pilih daftar kontak terlebih dahulu");
    if (!messageBody.trim()) return toast.error("Isi pesan wajib diisi");

    setSubmitting(true);
    try {
      const res = await apiClient.post("/campaigns", {
        name,
        contactListId,
        templateId: templateId || undefined,
        mediaFileId: mediaFileId || undefined,
        messageBody,
        delayPreset,
        minDelaySec: delayPreset === "CUSTOM" ? minDelay : undefined,
        maxDelaySec: delayPreset === "CUSTOM" ? maxDelay : undefined,
        maxPerHour,
      });
      toast.success("Campaign berhasil dibuat");
      router.push(`/campaigns/${res.data.data.id}`);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-10">
      <div>
        <h1 className="text-xl font-bold text-white">Buat Campaign Baru</h1>
        <p className="text-sm text-slate-500">Ikuti langkah berikut untuk menjalankan campaign WhatsApp Anda</p>
      </div>

      <WizardStep step={1} icon={MessageSquare} title="Informasi Campaign">
        <label className="mb-1.5 block text-xs font-medium text-slate-400">Nama Campaign</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Contoh: Promo Juli 2026"
          className="input-field"
        />
      </WizardStep>

      <WizardStep step={2} icon={Users} title="Pilih Daftar Kontak">
        {contactLists.length === 0 ? (
          <EmptyHint text="Belum ada daftar kontak." href="/import" cta="Import Nomor" />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {contactLists.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setContactListId(c.id)}
                className={cn(
                  "flex items-center justify-between rounded-xl border px-3.5 py-3 text-left transition-all",
                  contactListId === c.id
                    ? "border-accent-cyan/50 bg-accent-cyan/10 shadow-glow"
                    : "border-white/10 bg-white/[0.02] hover:border-white/20"
                )}
              >
                <span className="text-sm font-medium text-slate-200">{c.name}</span>
                <span className="text-xs text-slate-500">{c.totalCount} nomor</span>
              </button>
            ))}
          </div>
        )}
        {selectedContactList && selectedContactList.totalCount > 1000 && (
          <p className="mt-2 text-xs text-amber-400">Maksimal 1.000 nomor per campaign.</p>
        )}
      </WizardStep>

      <WizardStep step={3} icon={ImageIcon} title="Media (opsional)">
        {mediaItems.length === 0 ? (
          <EmptyHint text="Belum ada media." href="/media" cta="Upload Media" />
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setMediaFileId("")}
              className={cn(
                "rounded-xl border px-3 py-2 text-xs font-medium",
                mediaFileId === "" ? "border-accent-cyan/50 bg-accent-cyan/10" : "border-white/10 text-slate-400"
              )}
            >
              Tanpa Media
            </button>
            {mediaItems.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMediaFileId(m.id)}
                className={cn(
                  "relative h-16 w-16 overflow-hidden rounded-xl border-2 transition-all",
                  mediaFileId === m.id ? "border-accent-cyan shadow-glow" : "border-white/10"
                )}
              >
                {m.type === "IMAGE" ? (
                  <AuthImage
                    src={`/media/files/${(m.thumbnailPath ?? m.path).split("/").pop()}`}
                    alt={m.originalName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-base-950 text-[10px] text-slate-500">
                    {m.type}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </WizardStep>

      <WizardStep step={4} icon={FileText} title="Tulis Pesan">
        {templates.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => applyTemplate(t.id)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  templateId === t.id ? "bg-brand-gradient text-white" : "bg-white/5 text-slate-400 hover:bg-white/10"
                )}
              >
                {t.name}
              </button>
            ))}
          </div>
        )}
        <MessageEditor value={messageBody} onChange={setMessageBody} />
      </WizardStep>

      <WizardStep step={5} icon={Clock} title="Atur Jeda Pengiriman">
        <DelaySelector
          preset={delayPreset}
          onPresetChange={setDelayPreset}
          minDelay={minDelay}
          maxDelay={maxDelay}
          onMinChange={setMinDelay}
          onMaxChange={setMaxDelay}
          maxPerHour={maxPerHour}
          onMaxPerHourChange={setMaxPerHour}
        />
      </WizardStep>

      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={() => router.push("/campaigns")}>
          Batal
        </Button>
        <Button onClick={handleSubmit} loading={submitting}>
          <Check className="h-4 w-4" /> Simpan Campaign
        </Button>
      </div>
    </div>
  );
}

function WizardStep({
  step,
  icon: Icon,
  title,
  children,
}: {
  step: number;
  icon: typeof Users;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="mr-2.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white">
            {step}
          </span>
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-slate-600" />
      </CardHeader>
      {children}
    </Card>
  );
}

function EmptyHint({ text, href, cta }: { text: string; href: string; cta: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-white/[0.02] px-4 py-3">
      <p className="text-sm text-slate-500">{text}</p>
      <a href={href} className="text-xs font-medium text-accent-cyan hover:underline">
        {cta} →
      </a>
    </div>
  );
}
