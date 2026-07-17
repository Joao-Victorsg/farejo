import Link from "next/link";
import { navigation } from "@/lib/content";
import { Brand } from "@/components/brand";

export function SiteFooter() {
  return (
    <footer className="mt-auto bg-[#0d100e] text-[#eef0ea]">
      <div className="mx-auto grid max-w-[1160px] gap-10 px-5 py-12 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr]">
        <div><Brand inverse /><p className="mt-4 max-w-xs text-sm leading-6 text-[#9aa197]">Compare cashback antes de comprar e escolha a plataforma que melhor recompensa você.</p></div>
        <div><h2 className="font-mono text-[11px] font-medium tracking-[0.12em] text-[#9aa197]">PRODUTO</h2><ul className="mt-4 space-y-3 text-sm">{navigation.slice(0, 2).map((item) => <li key={item.href}><Link className="rounded-sm hover:text-[#4ade9b] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#4ade9b]" href={item.href}>{item.label}</Link></li>)}</ul></div>
        <div><h2 className="font-mono text-[11px] font-medium tracking-[0.12em] text-[#9aa197]">AJUDA</h2><ul className="mt-4 space-y-3 text-sm">{navigation.slice(2).map((item) => <li key={item.href}><Link className="rounded-sm hover:text-[#4ade9b] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#4ade9b]" href={item.href}>{item.label}</Link></li>)}</ul></div>
      </div>
      <div className="border-t border-white/10"><div className="mx-auto flex max-w-[1160px] flex-col gap-2 px-5 py-5 text-xs leading-5 text-[#7f867c] sm:px-8 md:flex-row md:justify-between"><span>© {new Date().getFullYear()} farejô</span><span>O cashback é pago pela plataforma escolhida e pode estar sujeito às regras dela.</span></div></div>
    </footer>
  );
}
