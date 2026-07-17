import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { faqs } from "@/lib/content";

export const metadata: Metadata = { title: "Perguntas frequentes" };

export default function FaqPage() {
  return <PageFrame><main id="conteudo" className="mx-auto w-full max-w-[1160px] px-5 py-16 sm:px-8 sm:py-24"><p className="font-mono text-xs font-medium tracking-[0.13em] text-[#1c7a4d]">FAQ</p><h1 className="mt-4 text-4xl font-bold tracking-[-0.05em] sm:text-5xl">Perguntas frequentes</h1><p className="mt-5 max-w-2xl text-lg leading-8 text-[#5b5f56]">O farejô compara ofertas. As plataformas são responsáveis pela ativação, pagamento e regras do cashback.</p><dl className="mt-14 grid gap-4">{faqs.map((faq, index) => <div className="rounded-2xl border border-[#ece9e2] bg-white p-7" key={faq.question}><dt className="flex gap-5 text-xl font-bold tracking-[-0.03em]"><span className="shrink-0 font-mono text-xs font-medium tracking-[0.12em] text-[#1c7a4d]">{String(index + 1).padStart(2, "0")}</span>{faq.question}</dt><dd className="mt-4 max-w-3xl pl-9 leading-7 text-[#5b5f56]">{faq.answer}</dd></div>)}</dl><section className="mt-14 border-t border-[#e0ddd4] pt-10"><h2 className="text-2xl font-bold tracking-[-0.04em]">Pronto para comparar?</h2><p className="mt-2 text-[#5b5f56]">Não há cadastro no farejô.</p><Link className="mt-5 inline-flex items-center gap-2 rounded-sm font-semibold text-[#1c7a4d] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1c7a4d]" href="/#catalogo">Buscar uma loja <ArrowRight aria-hidden="true" size={17} /></Link></section></main></PageFrame>;
}
