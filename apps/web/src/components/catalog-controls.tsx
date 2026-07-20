import Link from "next/link";
import { catalogHref, type CatalogSort } from "@/lib/catalog-url";

const SORTS: { value: CatalogSort; label: string }[] = [
  { value: "platforms", label: "Mais plataformas" },
  { value: "cashback", label: "Maior cashback" },
  { value: "az", label: "A–Z" },
];

interface CatalogControlsProps {
  query: string;
  sort: CatalogSort;
}

export function CatalogControls({ query, sort }: CatalogControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 font-mono text-[11px] tracking-[0.12em] text-[#5b5f56]">ORDENAR POR</span>
      {SORTS.map((option) => {
        const active = option.value === sort;
        return (
          <Link
            aria-current={active ? "true" : undefined}
            className={active
              ? "rounded-full bg-[#12140f] px-3.5 py-1.5 text-sm font-semibold text-white"
              : "rounded-full border border-[#e0ddd4] px-3.5 py-1.5 text-sm font-medium text-[#4d5149] hover:border-[#1c7a4d] hover:text-[#1c7a4d]"}
            href={`${catalogHref({ page: 1, query, sort: option.value })}#catalogo`}
            key={option.value}
          >
            {option.label}
          </Link>
        );
      })}
    </div>
  );
}
