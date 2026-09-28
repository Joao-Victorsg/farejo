"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Menu, Search, X } from "lucide-react";
import { navigation } from "@/lib/content";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileNavRef = useRef<HTMLElement>(null);

  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    mobileNavRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    }
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !headerRef.current?.contains(event.target)) setMenuOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-20 border-b border-[#ece9e2] bg-white/95 backdrop-blur" ref={headerRef}>
      <div className="mx-auto flex max-w-[1160px] items-center justify-between gap-3 px-5 py-3 sm:px-8 lg:py-4">
        <div className="flex min-w-0 items-center gap-11">
          <Brand />
          <nav aria-label="Navegação principal" className="hidden lg:block">
            <ul className="flex items-center gap-x-7 text-sm text-[#4d5149]">
              {navigation.map((item) => (
                <li key={item.href}><Link className="rounded-sm hover:text-[#1c7a4d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1c7a4d]" href={item.href}>{item.label}</Link></li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild className="min-h-11 gap-2 whitespace-nowrap px-3 lg:px-4"><Link aria-label="Buscar loja" href="/#catalogo" onClick={() => setMenuOpen(false)}><Search aria-hidden="true" size={18} /><span className="hidden lg:inline">Buscar loja</span></Link></Button>
          <button aria-controls="menu-mobile" aria-expanded={menuOpen} aria-label={menuOpen ? "Fechar menu" : "Abrir menu"} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[#e0ddd4] text-[#12140f] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1c7a4d] lg:hidden" onClick={() => setMenuOpen((open) => !open)} ref={menuButtonRef} type="button">
            {menuOpen ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}
          </button>
        </div>
      </div>
      <nav aria-label="Navegação mobile" className={`border-t border-[#ece9e2] bg-white px-5 py-3 sm:px-8 lg:hidden ${menuOpen ? "block" : "hidden"}`} id="menu-mobile" ref={mobileNavRef}>
        <ul className="mx-auto flex max-w-[1160px] flex-col gap-1">
          {navigation.map((item) => <li key={item.href}><Link className="block min-h-11 rounded-lg px-3 py-3 text-sm font-medium text-[#353a32] hover:bg-[#f2f9f5] focus-visible:outline-2 focus-visible:outline-[#1c7a4d]" href={item.href} onClick={() => setMenuOpen(false)}>{item.label}</Link></li>)}
        </ul>
      </nav>
    </header>
  );
}
