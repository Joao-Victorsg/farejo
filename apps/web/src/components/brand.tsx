import Link from "next/link";

interface BrandProps {
  inverse?: boolean;
}

export function Brand({ inverse = false }: BrandProps) {
  return (
    <Link aria-label="farejô — ir para lojas" className="inline-flex items-center gap-2.5" href="/">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt="" aria-hidden="true" className="h-9 w-auto" src={inverse ? "/brand-mark-light.svg" : "/brand-mark.svg"} />
      <span className={inverse ? "text-xl font-bold tracking-[-0.04em] text-[#eef0ea]" : "text-xl font-bold tracking-[-0.04em] text-[#12140f]"}>farejô</span>
    </Link>
  );
}
