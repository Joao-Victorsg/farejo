"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { catalogHref, type CatalogSort } from "@/lib/catalog-url";

interface PageJumpProps {
  query: string;
  sort: CatalogSort;
  totalPages: number;
}

/** Salto direto de página para catálogos longos, onde a lista truncada não alcança toda página. */
export function PageJump({ query, sort, totalPages }: PageJumpProps) {
  const router = useRouter();
  const [value, setValue] = useState("");

  return (
    <form
      className="flex items-center gap-2 text-sm text-[#5b5f56]"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed)) return;
        const page = Math.min(totalPages, Math.max(1, parsed));
        router.push(`${catalogHref({ page, query, sort })}#catalogo`);
      }}
    >
      <label className="whitespace-nowrap" htmlFor="page-jump">Ir para a página</label>
      <input
        aria-label={`Ir para a página (1 a ${totalPages})`}
        className="min-h-10 w-16 rounded-lg border border-[#e0ddd4] bg-white px-2 text-center outline-none focus:border-[#1c7a4d] focus:ring-2 focus:ring-[#cfe7d9]"
        id="page-jump"
        inputMode="numeric"
        max={totalPages}
        min={1}
        onChange={(event) => setValue(event.target.value)}
        type="number"
        value={value}
      />
      <button className="inline-flex min-h-10 items-center rounded-lg border border-[#e0ddd4] bg-white px-3 font-semibold text-[#12140f] hover:bg-[#f6f5f0]" type="submit">Ir</button>
    </form>
  );
}
