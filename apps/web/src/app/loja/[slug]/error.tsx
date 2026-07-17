"use client";

import { PageFrame } from "@/components/page-frame";

export default function StoreError({ reset }: { reset: () => void }) {
  return <PageFrame><main id="conteudo" tabIndex={-1}><section className="mx-auto w-full max-w-[960px] px-5 py-20 sm:px-8"><p className="font-mono text-xs font-medium tracking-[0.13em] text-[#1c7a4d]">LOJA</p><h1 className="mt-4 text-4xl font-bold tracking-[-0.05em]">Não conseguimos carregar esta loja agora.</h1><p className="mt-5 max-w-xl leading-7 text-[#5b5f56]">Tente novamente em alguns instantes. Nenhuma oferta foi tratada como indisponível.</p><button className="mt-8 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#1c7a4d] px-4 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1c7a4d]" onClick={reset} type="button">Tentar novamente</button></section></main></PageFrame>;
}
