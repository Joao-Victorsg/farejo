import Link from "next/link";
import { PageFrame } from "@/components/page-frame";

export default function StoreNotFound() {
  return <PageFrame><main id="conteudo" tabIndex={-1}><section className="mx-auto w-full max-w-[960px] px-5 py-20 sm:px-8"><p className="font-mono text-xs font-medium tracking-[0.13em] text-[#1c7a4d]">LOJA</p><h1 className="mt-4 text-4xl font-bold tracking-[-0.05em]">Loja não encontrada</h1><p className="mt-5 max-w-xl leading-7 text-[#5b5f56]">Não encontramos uma loja canônica com este endereço.</p><Link className="mt-8 inline-flex min-h-11 items-center font-semibold text-[#1c7a4d]" href="/#catalogo">Ver todas as lojas</Link></section></main></PageFrame>;
}
