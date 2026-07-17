import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <PageFrame>
      <main id="conteudo">
        <section className="border-b border-[#ece9e2] bg-[#faf9f5]"><div className="mx-auto max-w-[1160px] px-5 py-20 sm:px-8 sm:py-28"><p className="font-mono text-xs font-medium tracking-[0.13em] text-[#1c7a4d]">CASHBACK, SEM COMPLICAÇÃO</p><h1 className="mt-5 max-w-3xl text-4xl font-bold leading-[1.02] tracking-[-0.055em] sm:text-6xl">Compare antes de comprar.</h1><p className="mt-6 max-w-xl text-lg leading-8 text-[#5b5f56]">O farejô reúne as ofertas de cashback para ajudar você a escolher a melhor plataforma.</p><Button asChild className="mt-8 gap-2"><Link href="#catalogo"><Search aria-hidden="true" size={17} />Buscar uma loja</Link></Button></div></section>
        <section id="catalogo" className="mx-auto max-w-[1160px] px-5 py-16 sm:px-8"><p className="font-mono text-xs font-medium tracking-[0.13em] text-[#1c7a4d]">CATÁLOGO</p><h2 className="mt-3 text-3xl font-bold tracking-[-0.04em]">Em preparação</h2><p className="mt-4 max-w-2xl leading-7 text-[#5b5f56]">O catálogo público será conectado às ofertas verificadas na próxima etapa. Não exibimos lojas, valores ou estatísticas demonstrativas.</p><Link className="mt-7 inline-flex items-center gap-2 rounded-sm font-semibold text-[#1c7a4d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1c7a4d]" href="/como-funciona">Entenda como funciona <ArrowRight aria-hidden="true" size={17} /></Link></section>
      </main>
    </PageFrame>
  );
}
