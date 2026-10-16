"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Smartphone, CheckCircle2, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { apiClient, apiErrorMessage } from "@/lib/apiClient";
import { getSocket } from "@/lib/socket";
import { useSocket } from "@/components/providers/SocketProvider";
import { useAuthStore } from "@/store/authStore";
import { useWAStore, WAStatus } from "@/store/waStore";

type WAStatusPayload = {
  status: WAStatus;
  qr?: string;
  phoneNumber?: string;
  profileName?: string;
};

export default function WhatsAppConnectPage() {
  const { status, qr, phoneNumber, profileName, setStatus } = useWAStore();
  const accessToken = useAuthStore((s) => s.accessToken);
  const sharedSocket = useSocket();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    apiClient
      .get("/whatsapp/status")
      .then((res) => setStatus(res.data.data))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [setStatus]);

  useEffect(() => {
    const socket = sharedSocket ?? (accessToken ? getSocket(accessToken) : null);
    if (!socket) return;

    const handler = (payload: WAStatusPayload) => setStatus(payload);
    socket.on("whatsapp:status", handler);

    return () => {
      socket.off("whatsapp:status", handler);
    };
  }, [sharedSocket, accessToken, setStatus]);

  const handleConnect = async () => {
    setSubmitting(true);
    try {
      await apiClient.post("/whatsapp/connect");
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setSubmitting(true);
    try {
      await apiClient.post("/whatsapp/logout");
      setStatus({ status: "DISCONNECTED" });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const isConnected = status === "CONNECTED";
  const showQr = status === "QR_PENDING" && !!qr;
  const showPreparing =
    status === "CONNECTING" || status === "RECONNECTING" || (status === "QR_PENDING" && !qr);

  useEffect(() => {
    setStalled(false);
    if (!showPreparing) return;
    const timer = setTimeout(() => setStalled(true), 30000);
    return () => clearTimeout(timer);
  }, [status, showPreparing]);

  let viewKey = "idle";
  if (loading) viewKey = "loading";
  else if (isConnected) viewKey = "connected";
  else if (showQr) viewKey = "qr";
  else if (showPreparing) viewKey = "preparing";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Koneksi WhatsApp</h1>
        <p className="text-sm text-slate-500">
          Hubungkan nomor bisnis Anda dengan memindai QR Code dari WhatsApp melalui menu Perangkat Tertaut.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status Koneksi</CardTitle>
          <StatusBadge status={status} />
        </CardHeader>

        <div className="flex flex-col items-center gap-6 py-8">
          <AnimatePresence mode="wait">
            {viewKey === "connected" && (
              <motion.div
                key="connected"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="flex flex-col items-center gap-4 text-center"
              >
                <div className="flex h-28 w-28 items-center justify-center rounded-full bg-accent-green/10 ring-4 ring-accent-green/20">
                  <CheckCircle2 className="h-14 w-14 text-accent-green" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-white">WhatsApp Siap Digunakan</p>
                  <p className="text-sm text-slate-500 mt-2">
                    {profileName || "WhatsApp"} — Nomor Bisnis
                  </p>
                  {phoneNumber && (
                    <p className="text-xs text-slate-400 mt-1">Nomor: {phoneNumber}</p>
                  )}
                </div>
                <Button variant="danger" onClick={handleLogout} loading={submitting}>
                  Putuskan Koneksi
                </Button>
              </motion.div>
            )}

            {viewKey === "qr" && qr && (
              <motion.div
                key="qr"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-4 text-center"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qr}
                  alt="QR Code WhatsApp"
                  width={280}
                  height={280}
                  className="rounded-xl bg-white p-2"
                />
                <ol className="list-decimal space-y-1 pl-5 text-left text-sm text-slate-400">
                  <li>Buka WhatsApp di ponsel Anda.</li>
                  <li>Buka menu Perangkat Tertaut.</li>
                  <li>Ketuk Tautkan Perangkat, lalu pindai QR Code ini.</li>
                </ol>
              </motion.div>
            )}

            {viewKey === "preparing" && (
              <motion.div
                key="preparing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-4 text-center"
              >
                <Loader2 className="h-10 w-10 animate-spin text-slate-400" />
                <p className="text-sm text-slate-500">Menyiapkan QR Code...</p>
                {stalled && (
                  <p className="text-xs text-slate-500">
                    Belum ada QR Code. Klik Coba lagi untuk memulai ulang.
                  </p>
                )}
                <Button variant="secondary" onClick={handleConnect} loading={submitting}>
                  Coba lagi
                </Button>
              </motion.div>
            )}

            {viewKey === "idle" && (
              <motion.div
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-4 text-center"
              >
                <div className="flex h-28 w-28 items-center justify-center rounded-full bg-white/5 ring-1 ring-inset ring-white/10">
                  <Smartphone className="h-14 w-14 text-slate-600" />
                </div>
                {status === "LOGGED_OUT" && (
                  <p className="text-sm text-slate-500">Perangkat keluar. Pindai ulang QR Code.</p>
                )}
                <Button variant="primary" onClick={handleConnect} loading={submitting}>
                  Hubungkan WhatsApp
                </Button>
              </motion.div>
            )}

            {viewKey === "loading" && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-4 text-center"
              >
                <div className="flex h-28 w-28 items-center justify-center rounded-full bg-white/5 ring-1 ring-inset ring-white/10">
                  <div className="animate-pulse">
                    <CheckCircle2 className="h-14 w-14 text-slate-600" />
                  </div>
                </div>
                <p className="text-sm text-slate-500">Memeriksa status koneksi...</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Card>

      {!loading && status === "CONNECTED" && phoneNumber && (
        <Card>
          <CardHeader>
            <CardTitle>Informasi Koneksi</CardTitle>
          </CardHeader>
          <div className="grid grid-cols-1 gap-4 text-sm">
            {phoneNumber && (
              <InfoRow 
                icon={Smartphone} 
                label="Nomor WhatsApp" 
                value={phoneNumber} 
              />
            )}
          </div>
        </Card>
      )}

      {!loading && status === "CONNECTED" && (
        <Card className="border-accent-green/20 bg-accent-green/[0.03]">
          <div className="flex gap-3">
            <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-accent-green mt-0.5" />
            <p className="text-xs leading-relaxed text-accent-green/80">
              <strong>Status Aktif:</strong> Nomor bisnis siap menerima dan mengirim pesan. Anda dapat langsung membuat dan menjalankan campaign broadcast.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Smartphone; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/[0.02] p-3">
      <Icon className="h-4 w-4 text-slate-500" />
      <div>
        <p className="text-xs text-slate-500">{label}</p>
        <p className="font-medium text-slate-200">{value}</p>
      </div>
    </div>
  );
}

