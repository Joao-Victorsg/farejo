import Link from "next/link";
import { Search } from "lucide-react";
import { navigation } from "@/lib/content";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-[#ece9e2] bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1160px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4 sm:px-8">
        <div className="flex items-center gap-7 lg:gap-11">
          <Brand />
          <nav aria-label="Navegação principal">
            <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[#4d5149] sm:gap-x-7">
              {navigation.map((item) => (
                <li key={item.href}><Link className="rounded-sm hover:text-[#1c7a4d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1c7a4d]" href={item.href}>{item.label}</Link></li>
              ))}
            </ul>
          </nav>
        </div>
        <Button asChild className="gap-2 whitespace-nowrap"><Link href="/#catalogo"><Search aria-hidden="true" size={16} />Buscar loja</Link></Button>
      </div>
    </header>
  );
}
