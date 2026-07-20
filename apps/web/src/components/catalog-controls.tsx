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
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-sm text-[#5b5f56]">Ordenar por</span>
      {SORTS.map((option) => {
        const active = option.value === sort;
        return (
          <Link
            aria-current={active ? "true" : undefined}
            className={active
              ? "rounded-full border border-[#e0ddd4] bg-white px-3.5 py-1.5 text-sm font-semibold text-[#12140f] shadow-sm"
              : "rounded-full px-2.5 py-1.5 text-sm font-medium text-[#5b5f56] hover:text-[#12140f]"}
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
