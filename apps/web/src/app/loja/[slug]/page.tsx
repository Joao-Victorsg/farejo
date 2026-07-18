import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { StoreHistory } from "@/components/store-history";
import { StoreRanking } from "@/components/store-ranking";
import { getStoreDetail, getStoreRedirect } from "@/lib/catalog";
import { getSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

interface StorePageProps {
  params: Promise<{ slug: string }>;
}

function storeHref(slug: string) {
  return new URL(`/loja/${encodeURIComponent(slug)}`, getSiteUrl()).toString();
}

export async function generateMetadata({ params }: StorePageProps): Promise<Metadata> {
  const { slug } = await params;
  const redirectSlug = await getStoreRedirect(slug);
  if (redirectSlug) permanentRedirect(`/loja/${encodeURIComponent(redirectSlug)}`);
  const store = await getStoreDetail(slug);
  if (!store) notFound();

  return {
    title: `${store.name} — cashback`,
    description: store.offers.length > 0
      ? `Compare as ofertas de cashback disponíveis para ${store.name}.`
      : `As ofertas de cashback para ${store.name} estão temporariamente indisponíveis.`,
    alternates: { canonical: storeHref(store.slug) },
    robots: store.offers.length > 0 ? { index: true, follow: true } : { index: false, follow: true },
  };
}

export default async function StorePage({ params }: StorePageProps) {
  const { slug } = await params;
  const redirectSlug = await getStoreRedirect(slug);
  if (redirectSlug) permanentRedirect(`/loja/${encodeURIComponent(redirectSlug)}`);
  const store = await getStoreDetail(slug);
  if (!store) notFound();

  const initial = store.name.trim().charAt(0).toLocaleUpperCase("pt-BR") || "L";

  return (
    <PageFrame>
      <main id="conteudo" tabIndex={-1}>
        <section className="mx-auto w-full max-w-[960px] px-5 py-12 sm:px-8 sm:py-16">
          <Link className="inline-flex min-h-11 items-center gap-2 font-semibold text-[#1c7a4d] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#1c7a4d]" href="/#catalogo"><ArrowLeft aria-hidden="true" size={18} />Voltar para todas as lojas</Link>
          <header className="mt-8 rounded-2xl border border-[#ece9e2] bg-white p-6 sm:p-8">
            <div className="flex items-center gap-4">
              {store.logoUrl ? <img alt="" aria-hidden="true" className="size-16 rounded-2xl border border-[#ece9e2] object-contain p-1" height={64} src={store.logoUrl} width={64} /> : <span aria-hidden="true" className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-[#e7f4ec] font-mono text-2xl font-semibold text-[#1c7a4d]">{initial}</span>}
              <div><p className="font-mono text-xs font-medium tracking-[0.13em] text-[#1c7a4d]">LOJA CANÔNICA</p><h1 className="mt-2 text-3xl font-bold tracking-[-0.05em] sm:text-4xl">{store.name}</h1>{store.offers.length > 0 ? <p className="mt-2 text-[#5b5f56]">{store.platformCount} {store.platformCount === 1 ? "plataforma com cashback" : "plataformas com cashback"}</p> : null}</div>
            </div>
          </header>
          {store.offers.length === 0 ? (
            <section className="mt-8 rounded-2xl border border-[#e0ddd4] bg-[#faf9f5] p-6" aria-labelledby="unavailable-heading">
              <p className="font-mono text-xs font-medium tracking-[0.13em] text-[#8a6a33]">INDISPONÍVEL NO MOMENTO</p>
              <h2 className="mt-3 text-2xl font-bold" id="unavailable-heading">Nenhum cashback disponível no momento</h2>
              <p className="mt-3 max-w-2xl leading-7 text-[#5b5f56]">Esta loja continua cadastrada, mas não há uma oferta pública elegível para comparar agora. Volte mais tarde para conferir novas atualizações.</p>
            </section>
          ) : (
            <StoreRanking store={store} />
          )}
          <StoreHistory store={store} />
        </section>
      </main>
    </PageFrame>
  );
}
