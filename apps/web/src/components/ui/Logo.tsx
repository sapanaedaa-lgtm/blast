import Image from "next/image";
import { cn } from "@/lib/utils";

export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/logo-mark.svg"
      alt="Xnaedaa Blast"
      width={size}
      height={size}
      className={cn("select-none", className)}
      priority
    />
  );
}

export function LogoFull({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark size={32} />
      <div className="flex flex-col leading-none">
        <span className="text-[15px] font-bold tracking-tight text-white">
          Xnaedaa <span className="gradient-text">Blast</span>
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
          Smart WA Campaign
        </span>
      </div>
    </div>
  );
}
