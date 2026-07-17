"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { catalogHref, isCatalogSort, type CatalogSort } from "@/lib/catalog-url";

const SEARCH_DEBOUNCE_MS = 300;

interface CatalogControlsProps {
  query: string;
  sort: CatalogSort;
}

export function CatalogControls({ query, sort }: CatalogControlsProps) {
  const router = useRouter();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [input, setInput] = useState(query);
  const [selectedSort, setSelectedSort] = useState(sort);

  useEffect(() => {
    setInput(query);
    setSelectedSort(sort);
  }, [query, sort]);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  function href(nextQuery: string, nextSort: CatalogSort) {
    return catalogHref({ page: 1, query: nextQuery.trim(), sort: nextSort });
  }

  function submitImmediately(nextQuery: string, nextSort: CatalogSort) {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    router.push(href(nextQuery, nextSort));
  }

  return (
    <form action="/" className="mt-8 grid gap-3 rounded-2xl border border-[#e0ddd4] bg-[#faf9f5] p-4 md:grid-cols-[minmax(0,1fr)_auto_auto]" onSubmit={(event) => { event.preventDefault(); submitImmediately(input, selectedSort); }}>
      <label className="sr-only" htmlFor="catalog-search">Buscar loja</label>
      <div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#5b5f56]" size={18} /><input className="min-h-11 w-full rounded-xl border border-[#e0ddd4] bg-white py-2 pl-10 pr-3 text-sm outline-none focus:border-[#1c7a4d] focus:ring-2 focus:ring-[#cfe7d9]" id="catalog-search" name="q" onChange={(event) => { const nextQuery = event.target.value; setInput(nextQuery); if (timeoutRef.current) clearTimeout(timeoutRef.current); timeoutRef.current = setTimeout(() => router.replace(href(nextQuery, selectedSort)), SEARCH_DEBOUNCE_MS); }} placeholder="Busque uma loja" type="search" value={input} /></div>
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium" htmlFor="catalog-sort"><span className="sr-only">Ordenar por</span><select className="min-h-11 rounded-xl border border-[#e0ddd4] bg-white px-3 outline-none focus:border-[#1c7a4d] focus:ring-2 focus:ring-[#cfe7d9]" id="catalog-sort" name="sort" onChange={(event) => { const nextSort = isCatalogSort(event.target.value) ? event.target.value : "platforms"; setSelectedSort(nextSort); submitImmediately(input, nextSort); }} value={selectedSort}><option value="platforms">Mais plataformas</option><option value="cashback">Maior cashback</option><option value="az">A–Z</option></select></label>
      <Button className="gap-2" type="submit"><Search aria-hidden="true" size={17} />Buscar</Button>
    </form>
  );
}
