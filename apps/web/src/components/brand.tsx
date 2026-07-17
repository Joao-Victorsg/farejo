import Link from "next/link";
import { Percent } from "lucide-react";

interface BrandProps {
  inverse?: boolean;
}

export function Brand({ inverse = false }: BrandProps) {
  return (
    <Link aria-label="farejô — ir para lojas" className="inline-flex items-center gap-2.5" href="/">
      <span className="flex size-9 items-center justify-center rounded-[11px] bg-[#1c7a4d] text-white" aria-hidden="true">
        <Percent size={19} strokeWidth={3} />
      </span>
      <span className={inverse ? "text-xl font-bold tracking-[-0.04em] text-[#eef0ea]" : "text-xl font-bold tracking-[-0.04em] text-[#12140f]"}>farejô</span>
    </Link>
  );
}
