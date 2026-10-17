"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Wifi, WifiOff, Loader2, QrCode, Bell } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useWAStore } from "@/store/waStore";
import { useNotificationStore } from "@/store/notificationStore";
import { cn } from "@/lib/utils";

function useClock() {
  const [time, setTime] = useState<string>("");
  useEffect(() => {
    const update = () =>
      setTime(
        new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      );
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

function WAStatusPill() {
  const status = useWAStore((s) => s.status);
  const time = useClock();

  const config = {
    CONNECTED: { icon: Wifi, label: "Connected", tone: "text-accent-green bg-accent-green/10 ring-accent-green/30" },
    QR_PENDING: { icon: QrCode, label: "QR Active", tone: "text-amber-400 bg-amber-500/10 ring-amber-500/30" },
    CONNECTING: { icon: Loader2, label: "Connecting", tone: "text-accent-cyan bg-accent-cyan/10 ring-accent-cyan/30" },
    RECONNECTING: { icon: Loader2, label: "Reconnecting", tone: "text-accent-cyan bg-accent-cyan/10 ring-accent-cyan/30" },
    DISCONNECTED: { icon: WifiOff, label: "Disconnected", tone: "text-slate-400 bg-white/5 ring-white/10" },
    LOGGED_OUT: { icon: WifiOff, label: "Logged Out", tone: "text-red-400 bg-red-500/10 ring-red-500/30" },
  }[status];

  const Icon = config.icon;

  return (
    <Link
      href="/whatsapp"
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors",
        config.tone
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", (status === "CONNECTING" || status === "RECONNECTING") && "animate-spin")} />
      {config.label}
      <span className="ml-1 hidden text-slate-500 sm:inline">· {time}</span>
    </Link>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const items = useNotificationStore((s) => s.items);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const unread = items.filter((i) => !i.read).length;

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((o) => !o);
          if (!open) markAllRead();
        }}
        className="relative rounded-xl p-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent-cyan shadow-glow" />
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-2xl border border-white/10 bg-base-800/95 p-2 shadow-soft backdrop-blur-xl">
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-500">Belum ada notifikasi</p>
            ) : (
              items.map((n) => (
                <div key={n.id} className="rounded-xl px-3 py-2.5 hover:bg-white/[0.04]">
                  <p className="text-sm font-medium text-slate-200">{n.title}</p>
                  {n.message && <p className="mt-0.5 text-xs text-slate-500">{n.message}</p>}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function Topbar() {
  const user = useAuthStore((s) => s.user);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-white/[0.06] bg-base-900/70 px-4 backdrop-blur-xl lg:px-8">
      <div>
        <p className="text-sm font-medium text-slate-200">
          Halo, {user?.name?.split(" ")[0] ?? "User"} 👋
        </p>
        <p className="text-xs text-slate-500">Selamat datang kembali di Xnaedaa Blast</p>
      </div>

      <div className="flex items-center gap-3">
        <WAStatusPill />
        <NotificationBell />
        <div className="hidden h-9 w-9 items-center justify-center rounded-full bg-brand-gradient text-sm font-semibold text-white sm:flex">
          {user?.name?.[0]?.toUpperCase() ?? "U"}
        </div>
      </div>
    </header>
  );
}
