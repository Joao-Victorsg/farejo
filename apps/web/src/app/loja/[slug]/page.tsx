import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { FreshnessSummary } from "@/components/freshness-summary";
import { PageFrame } from "@/components/page-frame";
import { getStoreDetail } from "@/lib/catalog";
import { formatReward, rankOffers } from "@/lib/offer-ranking";
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
  const store = await getStoreDetail(slug);
  if (!store) notFound();

  const offers = rankOffers(store.offers);
  const initial = store.name.trim().charAt(0).toLocaleUpperCase("pt-BR") || "L";
  const oldestSeenAt = offers.reduce<string | null>((oldest, offer) => !oldest || offer.lastSeenAt < oldest ? offer.lastSeenAt : oldest, null);

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
          {offers.length === 0 ? (
            <section className="mt-8 rounded-2xl border border-[#e0ddd4] bg-[#faf9f5] p-6" aria-labelledby="unavailable-heading">
              <p className="font-mono text-xs font-medium tracking-[0.13em] text-[#8a6a33]">INDISPONÍVEL NO MOMENTO</p>
              <h2 className="mt-3 text-2xl font-bold" id="unavailable-heading">Nenhum cashback disponível no momento</h2>
              <p className="mt-3 max-w-2xl leading-7 text-[#5b5f56]">Esta loja continua cadastrada, mas não há uma oferta pública elegível para comparar agora. Volte mais tarde para conferir novas atualizações.</p>
            </section>
          ) : (
            <section className="mt-8" aria-labelledby="ranking-heading">
              <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="font-mono text-xs font-medium tracking-[0.13em] text-[#1c7a4d]">OFERTAS ELEGÍVEIS</p><h2 className="mt-2 text-3xl font-bold tracking-[-0.04em]" id="ranking-heading">Ranking de cashback</h2></div>{oldestSeenAt ? <FreshnessSummary lastSeenAt={oldestSeenAt} /> : null}</div>
              <ol className="mt-5 space-y-3" aria-label={`Ranking de cashback de ${store.name}`}>
                {offers.map((offer, index) => <li className={`flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border p-4 sm:p-5 ${index === 0 ? "border-[#cfe7d9] bg-[#f2f9f5]" : "border-[#ece9e2] bg-white"}`} key={offer.platformId}>
                  <span aria-label={`${index + 1}ª posição`} className="font-mono text-sm font-semibold text-[#5b5f56]">{String(index + 1).padStart(2, "0")}</span>
                  <div className="min-w-32 flex-1"><p className="font-semibold">{offer.platformName}</p><div className="mt-1 flex flex-wrap gap-2 text-xs">{index === 0 ? <span className="rounded-full bg-[#e7f4ec] px-2 py-1 font-mono font-medium text-[#1c7a4d]">MELHOR</span> : null}{offer.reward.type === "fixed" ? <span className="rounded-full bg-[#f0e7d3] px-2 py-1 font-mono font-medium text-[#8a6a33]">VALOR FIXO</span> : null}{offer.freshness === "delayed" ? <span className="rounded-full bg-[#f0e7d3] px-2 py-1 font-mono font-medium text-[#8a6a33]">ATUALIZAÇÃO ATRASADA</span> : null}</div></div>
                  <div className="ml-auto text-right"><p className="font-numbers text-xl font-bold text-[#1c7a4d]">{formatReward(offer)}</p>{offer.reward.type === "percent" && offer.reward.isUpto ? <p className="mt-1 text-xs text-[#5b5f56]">Teto anunciado pela plataforma</p> : null}</div>
                </li>)}
              </ol>
              <p className="mt-5 rounded-xl bg-[#faf9f5] p-4 text-sm leading-6 text-[#5b5f56]">As ofertas são informativas e podem mudar conforme as condições de cada plataforma. Confirme os detalhes antes de comprar.</p>
            </section>
          )}
        </section>
      </main>
    </PageFrame>
  );
}
