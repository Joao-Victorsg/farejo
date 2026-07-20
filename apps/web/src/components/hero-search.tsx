"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { catalogHref } from "@/lib/catalog-url";

export function HeroSearch({ query, placeholder }: { query: string; placeholder: string }) {
  const router = useRouter();
  const [input, setInput] = useState(query);

  return (
    <form
      className="mt-8 flex max-w-xl items-center gap-2 rounded-2xl border border-[#e0ddd4] bg-white p-2 shadow-[0_6px_24px_-14px_rgba(0,0,0,.25)]"
      onSubmit={(event) => {
        event.preventDefault();
        router.push(`${catalogHref({ page: 1, query: input.trim(), sort: "platforms" })}#catalogo`);
      }}
    >
      <label className="sr-only" htmlFor="hero-search">Buscar loja</label>
      <div className="relative flex-1">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#5b5f56]" size={18} />
        <input
          className="min-h-11 w-full rounded-xl bg-transparent py-2 pl-10 pr-3 text-sm outline-none"
          id="hero-search"
          name="q"
          onChange={(event) => setInput(event.target.value)}
          placeholder={placeholder}
          type="search"
          value={input}
        />
      </div>
      <Button className="shrink-0 gap-2" type="submit"><Search aria-hidden="true" size={17} />Buscar</Button>
    </form>
  );
}
