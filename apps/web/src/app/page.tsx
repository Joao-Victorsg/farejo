import Link from "next/link";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { Button } from "@/components/ui/button";
import { CATALOG_PAGE_SIZE, getCatalogPage, type CatalogOffer, type CatalogStore } from "@/lib/catalog";
import { editorial } from "@/lib/content";

export const dynamic = "force-dynamic";

interface HomePageProps {
  searchParams: Promise<{ page?: string | string[] }>;
}

function parsePage(value: string | string[] | undefined) {
  if (typeof value !== "string") return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function formatHeroStoreCount(total: number) {
  if (total < 100) return new Intl.NumberFormat("pt-BR").format(total);
  return `${new Intl.NumberFormat("pt-BR").format(Math.floor(total / 100) * 100)}+`;
}

function formatReward(offer: CatalogOffer) {
  if (offer.reward.type === "percent") return `${offer.reward.isUpto ? "Até " : ""}${offer.reward.value.toLocaleString("pt-BR")}%`;
  return offer.reward.value.toLocaleString("pt-BR", { style: "currency", currency: offer.reward.currency });
}

function sortOffers(offers: CatalogOffer[]) {
  return [...offers].sort((left, right) => {
    if (left.reward.type !== right.reward.type) return left.reward.type === "percent" ? -1 : 1;
    return right.reward.value - left.reward.value;
  });
}

function CatalogCard({ store }: { store: CatalogStore }) {
  const offers = sortOffers(store.offers);
  const initial = store.name.trim().charAt(0).toLocaleUpperCase("pt-BR") || "L";

  return (
    <article className="rounded-2xl border border-[#ece9e2] bg-white p-5 shadow-[0_10px_30px_-18px_rgba(0,0,0,.25)]">
      <div className="flex items-start gap-3">
        {store.logoUrl ? (
          <img alt={`Logo da ${store.name}`} className="size-12 rounded-xl border border-[#ece9e2] object-contain p-1" height={48} src={store.logoUrl} width={48} />
        ) : (
          <span aria-label={`Logo indisponível para ${store.name}`} className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[#e7f4ec] font-mono text-lg font-semibold text-[#1c7a4d]">{initial}</span>
        )}
        <div className="min-w-0"><h3 className="truncate text-lg font-bold tracking-[-0.03em]">{store.name}</h3><p className="mt-1 text-sm text-[#5b5f56]">{store.platformCount} {store.platformCount === 1 ? "plataforma" : "plataformas"}</p></div>
      </div>
      <ul className="mt-5 space-y-2" aria-label={`Ofertas de ${store.name}`}>
        {offers.map((offer) => (
          <li className="flex items-center justify-between gap-3 rounded-lg bg-[#faf9f5] px-3 py-2 text-sm" key={offer.platformId}>
            <span className="min-w-0 truncate font-medium">{offer.platformName}</span>
            <span className="flex shrink-0 items-center gap-2 font-semibold text-[#1c7a4d]">{formatReward(offer)}{offer.freshness === "delayed" ? <span className="rounded-full bg-[#f0e7d3] px-2 py-0.5 font-mono text-[10px] font-medium text-[#8a6a33]">Atualização atrasada</span> : null}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function pageHref(page: number) {
  return page === 1 ? "/#catalogo" : `/?page=${page}#catalogo`;
}

function Pagination({ page, totalPages }: { page: number; totalPages: number }) {
  if (totalPages < 2) return null;

  return (
    <nav aria-label="Paginação do catálogo" className="mt-10 flex flex-wrap items-center justify-center gap-2">
      {page > 1 ? <Link className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-[#e0ddd4] px-3 text-sm font-semibold" href={pageHref(page - 1)}><ArrowLeft aria-hidden="true" size={16} />Anterior</Link> : <span aria-disabled="true" className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-[#ece9e2] px-3 text-sm text-[#9a9d94]"><ArrowLeft aria-hidden="true" size={16} />Anterior</span>}
      {Array.from({ length: totalPages }, (_, index) => index + 1).map((candidate) => candidate === page ? <span aria-current="page" className="inline-flex size-10 items-center justify-center rounded-lg bg-[#1c7a4d] text-sm font-semibold text-white" key={candidate}>{candidate}</span> : <Link className="inline-flex size-10 items-center justify-center rounded-lg border border-[#e0ddd4] text-sm font-semibold" href={pageHref(candidate)} key={candidate}>{candidate}</Link>)}
      {page < totalPages ? <Link className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-[#e0ddd4] px-3 text-sm font-semibold" href={pageHref(page + 1)}>Próxima<ArrowRight aria-hidden="true" size={16} /></Link> : <span aria-disabled="true" className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-[#ece9e2] px-3 text-sm text-[#9a9d94]">Próxima<ArrowRight aria-hidden="true" size={16} /></span>}
    </nav>
  );
}

function HomeError() {
  return <PageFrame><main id="conteudo" tabIndex={-1}><section className="mx-auto max-w-[1160px] px-5 py-24 sm:px-8"><p className="font-mono text-xs font-medium tracking-[0.13em] text-[#1c7a4d]">CATÁLOGO</p><h1 className="mt-4 text-4xl font-bold tracking-[-0.05em]">Não conseguimos carregar as lojas agora.</h1><p className="mt-5 max-w-xl leading-7 text-[#5b5f56]">Tente novamente em alguns instantes. Nenhuma oferta foi tratada como indisponível.</p><Button asChild className="mt-8"><Link href="/">Tentar novamente</Link></Button></section></main></PageFrame>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const page = parsePage((await searchParams).page);
  let catalog;

  try {
    catalog = await getCatalogPage(page);
  } catch {
    return <HomeError />;
  }

  const pageOutOfRange = catalog.total > 0 && page > catalog.totalPages;

  return (
    <PageFrame>
      <main id="conteudo" tabIndex={-1}>
        <section className="border-b border-[#ece9e2] bg-[#faf9f5]"><div className="mx-auto max-w-[1160px] px-5 py-20 sm:px-8 sm:py-28"><p className="font-mono text-xs font-medium tracking-[0.13em] text-[#1c7a4d]">{editorial.home.eyebrow}</p><h1 className="mt-5 max-w-3xl text-4xl font-bold leading-[1.02] tracking-[-0.055em] sm:text-6xl">{editorial.home.title}</h1><p className="mt-6 max-w-xl text-lg leading-8 text-[#5b5f56]">{editorial.home.description}</p><Button asChild className="mt-8 gap-2"><Link href="#catalogo"><Search aria-hidden="true" size={17} />{editorial.home.cta}</Link></Button><dl className="mt-12 grid max-w-xl gap-3 sm:grid-cols-2"><div className="rounded-xl border border-[#ece9e2] bg-white p-4"><dt className="font-mono text-[11px] tracking-[0.12em] text-[#5b5f56]">LOJAS ELEGÍVEIS</dt><dd className="mt-1 font-mono text-2xl font-semibold text-[#1c7a4d]">{formatHeroStoreCount(catalog.total)}</dd></div><div className="rounded-xl border border-[#ece9e2] bg-white p-4"><dt className="font-mono text-[11px] tracking-[0.12em] text-[#5b5f56]">PLATAFORMAS</dt><dd className="mt-1 font-mono text-2xl font-semibold text-[#1c7a4d]">5</dd></div></dl></div></section>
        <section id="catalogo" className="mx-auto max-w-[1160px] px-5 py-16 sm:px-8"><p className="font-mono text-xs font-medium tracking-[0.13em] text-[#1c7a4d]">CATÁLOGO</p><h2 className="mt-3 text-3xl font-bold tracking-[-0.04em]">Todas as lojas</h2><p className="mt-4 max-w-2xl leading-7 text-[#5b5f56]">Ordenadas pela quantidade de plataformas com cashback verificado.</p>{catalog.total === 0 ? <div className="mt-8 rounded-2xl border border-[#e0ddd4] bg-[#faf9f5] p-6"><h3 className="text-xl font-bold">O catálogo está temporariamente vazio.</h3><p className="mt-2 text-[#5b5f56]">Isso pode indicar uma anomalia nos dados. Tente novamente em alguns instantes.</p></div> : pageOutOfRange ? <div className="mt-8 rounded-2xl border border-[#e0ddd4] bg-[#faf9f5] p-6"><h3 className="text-xl font-bold">Esta página não existe.</h3><p className="mt-2 text-[#5b5f56]">Volte para a primeira página do catálogo para continuar navegando.</p><Link className="mt-4 inline-flex font-semibold text-[#1c7a4d]" href="/#catalogo">Ir para a primeira página</Link></div> : <><div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{catalog.items.map((store) => <CatalogCard key={store.slug} store={store} />)}</div><Pagination page={catalog.page} totalPages={catalog.totalPages} /><p className="mt-5 text-center text-sm text-[#5b5f56]">Página {catalog.page} de {catalog.totalPages} · {catalog.total} lojas elegíveis · {CATALOG_PAGE_SIZE} por página</p></>}</section>
      </main>
    </PageFrame>
  );
}
