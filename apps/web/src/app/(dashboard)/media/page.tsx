"use client";

import { useEffect, useState } from "react";
import { Trash2, FileVideo, FileText as FileIcon } from "lucide-react";
import toast from "react-hot-toast";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { FileDropzone } from "@/components/ui/FileDropzone";
import { AuthImage } from "@/components/ui/AuthImage";
import { apiClient, apiErrorMessage } from "@/lib/apiClient";
import { cn } from "@/lib/utils";

interface MediaItem {
  id: string;
  originalName: string;
  type: "IMAGE" | "VIDEO" | "DOCUMENT" | "NONE";
  path: string;
  thumbnailPath: string | null;
  sizeBytes: number;
  createdAt: string;
}

export default function MediaPage() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await apiClient.get("/media", { params: { limit: 60 } });
      setItems(res.data.data.items);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await apiClient.post("/media/upload", form, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Media berhasil diupload");
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Hapus media ini?")) return;
    try {
      await apiClient.delete(`/media/${id}`);
      setItems((prev) => prev.filter((i) => i.id !== id));
      toast.success("Media dihapus");
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Media</h1>
        <p className="text-sm text-slate-500">Kelola foto dan video untuk campaign — maksimal 50MB, otomatis dikompres</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload Media Baru</CardTitle>
        </CardHeader>
        <FileDropzone
          accept=".png,.jpg,.jpeg,.webp,.gif,.mp4"
          label={uploading ? "Mengupload..." : "Klik atau drag & drop foto/video di sini"}
          hint="PNG, JPG, JPEG, WEBP, GIF, MP4 — maks 50MB"
          onFile={handleUpload}
        />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Galeri Media</CardTitle>
        </CardHeader>
        {loading ? (
          <p className="py-10 text-center text-sm text-slate-500">Memuat...</p>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">Belum ada media</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {items.map((m) => (
              <div key={m.id} className="group relative overflow-hidden rounded-xl border border-white/[0.05] bg-white/[0.02]">
                <div className="flex aspect-square items-center justify-center bg-base-950/50">
                  {m.type === "IMAGE" ? (
                    <AuthImage
                      src={`/media/files/${(m.thumbnailPath ?? m.path).split("/").pop()}`}
                      alt={m.originalName}
                      className="h-full w-full object-cover"
                    />
                  ) : m.type === "VIDEO" ? (
                    <FileVideo className="h-8 w-8 text-slate-500" />
                  ) : (
                    <FileIcon className="h-8 w-8 text-slate-500" />
                  )}
                </div>
                <div className="p-2">
                  <p className="truncate text-[11px] text-slate-400">{m.originalName}</p>
                  <p className="text-[10px] text-slate-600">{(m.sizeBytes / 1024).toFixed(0)} KB</p>
                </div>
                <button
                  onClick={() => handleDelete(m.id)}
                  className={cn(
                    "absolute right-1.5 top-1.5 rounded-lg bg-black/60 p-1.5 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100"
                  )}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
