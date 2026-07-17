import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { howItWorks } from "@/lib/content";

export const metadata: Metadata = { title: "Como funciona" };

export default function HowItWorksPage() {
  return <PageFrame><main id="conteudo" className="mx-auto w-full max-w-[1160px] px-5 py-16 sm:px-8 sm:py-24"><p className="font-mono text-xs font-medium tracking-[0.13em] text-[#1c7a4d]">COMO FUNCIONA</p><h1 className="mt-4 max-w-2xl text-4xl font-bold tracking-[-0.05em] sm:text-5xl">Como o farejô funciona</h1><p className="mt-5 max-w-2xl text-lg leading-8 text-[#5b5f56]">Você compara, escolhe e ativa. A compra segue normalmente na loja e o cashback continua sendo responsabilidade da plataforma escolhida.</p><ol className="mt-14 grid gap-4 md:grid-cols-3">{howItWorks.map((step) => <li className="rounded-2xl border border-[#ece9e2] bg-white p-7" key={step.number}><span className="font-mono text-xs font-medium tracking-[0.12em] text-[#1c7a4d]">{step.number}</span><h2 className="mt-10 text-xl font-bold tracking-[-0.03em]">{step.title}</h2><p className="mt-3 leading-7 text-[#5b5f56]">{step.description}</p></li>)}</ol><section className="mt-14 rounded-2xl bg-[#0d100e] p-8 text-[#eef0ea] sm:flex sm:items-center sm:justify-between sm:gap-8"><div><h2 className="text-2xl font-bold tracking-[-0.04em]">Ainda tem dúvidas?</h2><p className="mt-2 text-[#9aa197]">Veja respostas sobre cadastro, valores e recebimento.</p></div><Link className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#4ade9b] px-4 font-semibold text-[#0d100e] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#4ade9b] sm:mt-0" href="/faq">Ir para a FAQ <ArrowRight aria-hidden="true" size={17} /></Link></section></main></PageFrame>;
}
