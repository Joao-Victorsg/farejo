"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Check, Shirt, House, Laptop, Sparkles, Utensils, HeartPulse, Dumbbell, PawPrint, Plane, BookOpen, Gamepad2, Monitor, Car, Gift, Landmark, Wifi, Tag, type LucideIcon } from "lucide-react";
import type { CatalogCategory } from "@/lib/catalog";
import { catalogHref, type CatalogRequest } from "@/lib/catalog-url";

const icons: Readonly<Record<string, LucideIcon>> = {
  shirt: Shirt, house: House, laptop: Laptop, sparkles: Sparkles, utensils: Utensils,
  "heart-pulse": HeartPulse, dumbbell: Dumbbell, "paw-print": PawPrint, plane: Plane,
  "book-open": BookOpen, "gamepad-2": Gamepad2, monitor: Monitor, car: Car, gift: Gift,
  landmark: Landmark, wifi: Wifi,
};

export function CategoryFilter({ categories, request }: { categories: CatalogCategory[]; request: CatalogRequest }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  if (categories.length === 0) return null;
  return (
    <div className="relative mt-3" ref={container} onKeyDown={(event) => {
      if (event.key === "Escape" && open) { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    }} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button aria-controls={panelId} aria-expanded={open} className="inline-flex items-center gap-2 rounded-full border border-[#e0ddd4] bg-white px-3.5 py-1.5 text-sm font-semibold text-[#12140f] shadow-sm hover:bg-[#f6f5f0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1c7a4d] [@media(pointer:coarse)]:min-h-11" onClick={() => setOpen(!open)} ref={trigger} type="button">
        Categorias<ChevronDown aria-hidden="true" size={14} className={open ? "rotate-180" : undefined} />
      </button>
      <nav aria-label="Categorias de lojas" className="absolute left-0 top-full z-30 mt-2 max-h-[min(70dvh,32rem)] w-full max-w-[760px] overflow-y-auto rounded-2xl border border-[#e0ddd4] bg-white p-4 shadow-[0_10px_30px_-18px_rgba(0,0,0,.25)] sm:p-6" hidden={!open} id={panelId}>
        <Link aria-current={!request.category ? "true" : undefined} className="mb-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[#1c7a4d]" href={`${catalogHref({ ...request, category: undefined, page: 1 })}#catalogo`} onClick={() => setOpen(false)}>
          {!request.category ? <Check aria-hidden="true" size={16} /> : null}Todas as lojas
        </Link>
        <ul className="grid list-none grid-cols-1 gap-1 border-t border-[#ece9e2] pt-3 min-[390px]:grid-cols-2 md:grid-cols-3">
          {categories.map((category) => {
            const Icon = icons[category.icon] ?? Tag;
            const active = request.category === category.slug;
            return <li key={category.slug}><Link aria-current={active ? "true" : undefined} className={`flex min-h-11 items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-[#f6f5f0] focus-visible:outline-2 focus-visible:outline-[#1c7a4d] ${active ? "bg-[#e7f4ec] font-semibold text-[#1c7a4d]" : "text-[#5b5f56]"}`} href={`${catalogHref({ ...request, category: category.slug, page: 1 })}#catalogo`} onClick={() => setOpen(false)}><Icon aria-hidden="true" className="shrink-0" size={17} /><span>{category.name}</span>{active ? <Check aria-hidden="true" className="shrink-0" size={14} /> : null}</Link></li>;
          })}
        </ul>
      </nav>
    </div>
  );
}
