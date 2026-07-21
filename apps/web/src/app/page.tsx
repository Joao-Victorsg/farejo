import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { CatalogCard } from "@/components/catalog-card";
import { CatalogControls } from "@/components/catalog-controls";
import { HeroSearch } from "@/components/hero-search";
import { InterToggle } from "@/components/inter-toggle";
import { PageJump } from "@/components/page-jump";
import { Button } from "@/components/ui/button";
import { catalogHref, getCatalogPage, parseCatalogRequest, type CatalogRequest } from "@/lib/catalog";
import { editorial } from "@/lib/content";

export const dynamic = "force-dynamic";

interface HomePageProps {
  searchParams: Promise<{ page?: string | string[]; q?: string | string[]; sort?: string | string[] }>;
}

function formatHeroStoreCount(total: number) {
  if (total < 100) return new Intl.NumberFormat("pt-BR").format(total);
  return `${new Intl.NumberFormat("pt-BR").format(Math.floor(total / 100) * 100)}+`;
}

function hrefForCatalog(request: CatalogRequest) {
  return `${catalogHref(request)}#catalogo`;
}

/** Janela compacta com primeira/última página, vizinhas da atual e reticências nos vãos. */
function paginationItems(current: number, total: number): (number | "gap")[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, "gap", total];
  if (current >= total - 3) return [1, "gap", total - 4, total - 3, total - 2, total - 1, total];
  return [1, "gap", current - 1, current, current + 1, "gap", total];
}

function Pagination({ request, totalPages }: { request: CatalogRequest; totalPages: number }) {
  if (totalPages < 2) return null;

  const items = paginationItems(request.page, totalPages);
  const edge = "inline-flex min-h-10 items-center gap-1 rounded-lg px-3 text-sm font-semibold";

  return (
    <nav aria-label={`Paginação do catálogo, página ${request.page} de ${totalPages}`} className="mt-10 flex flex-col items-center gap-4">
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {request.page > 1 ? <Link className={`${edge} border border-[#e0ddd4] hover:bg-[#f6f5f0]`} href={hrefForCatalog({ ...request, page: request.page - 1 })}><ArrowLeft aria-hidden="true" size={16} />Anterior</Link> : <span aria-disabled="true" className={`${edge} border border-[#ece9e2] text-[#70736a]`}><ArrowLeft aria-hidden="true" size={16} />Anterior</span>}
        {items.map((item, index) => item === "gap"
          ? <span aria-hidden="true" className="inline-flex size-10 items-center justify-center text-sm text-[#70736a]" key={`gap-${index}`}>…</span>
          : item === request.page
          ? <span aria-current="page" className="inline-flex size-10 items-center justify-center rounded-lg bg-[#1c7a4d] text-sm font-semibold text-white" key={item}>{item}</span>
          : <Link aria-label={`Página ${item}`} className="inline-flex size-10 items-center justify-center rounded-lg border border-[#e0ddd4] text-sm font-semibold hover:bg-[#f6f5f0]" href={hrefForCatalog({ ...request, page: item })} key={item}>{item}</Link>)}
        {request.page < totalPages ? <Link className={`${edge} border border-[#e0ddd4] hover:bg-[#f6f5f0]`} href={hrefForCatalog({ ...request, page: request.page + 1 })}>Próxima<ArrowRight aria-hidden="true" size={16} /></Link> : <span aria-disabled="true" className={`${edge} border border-[#ece9e2] text-[#70736a]`}>Próxima<ArrowRight aria-hidden="true" size={16} /></span>}
      </div>
      {totalPages > 7 ? <PageJump query={request.query} sort={request.sort} totalPages={totalPages} /> : null}
    </nav>
  );
}

function HomeError() {
  return <PageFrame><main id="conteudo" tabIndex={-1}><section className="mx-auto max-w-[1160px] px-5 py-24 sm:px-8"><p className="font-mono text-xs font-medium tracking-[0.13em] text-[#1c7a4d]">CATÁLOGO</p><h1 className="mt-4 text-4xl font-bold tracking-[-0.05em]">Não conseguimos carregar as lojas agora.</h1><p className="mt-5 max-w-xl leading-7 text-[#5b5f56]">Tente novamente em alguns instantes. Nenhuma oferta foi tratada como indisponível.</p><Button asChild className="mt-8"><Link href="/">Tentar novamente</Link></Button></section></main></PageFrame>;
}

function PageNotFound() {
  return <div className="mt-8 rounded-2xl border border-[#e0ddd4] bg-[#faf9f5] p-6"><h3 className="text-xl font-bold">Esta página não existe.</h3><p className="mt-2 text-[#5b5f56]">Volte para a primeira página do catálogo para continuar navegando.</p><Link className="mt-4 inline-flex font-semibold text-[#1c7a4d]" href="/#catalogo">Ir para a primeira página</Link></div>;
}

export async function generateMetadata({ searchParams }: HomePageProps): Promise<Metadata> {
  const request = parseCatalogRequest(await searchParams);
  let pageOutOfRange = false;

  if (!request.invalidPage && !request.invalidParameters) {
    try {
      const catalog = await getCatalogPage(request);
      pageOutOfRange = catalog.total > 0 && request.page > catalog.totalPages;
    } catch {
      pageOutOfRange = true;
    }
  }

  const noindex = request.invalidPage || request.invalidParameters || pageOutOfRange || Boolean(request.query) || request.sort !== "platforms";

  return {
    alternates: { canonical: catalogHref(request) },
    robots: noindex ? { index: false, follow: true } : { index: true, follow: true },
  };
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const request = parseCatalogRequest(await searchParams);
  if (request.needsCanonicalRedirect) redirect(catalogHref(request));

  if (request.invalidPage || request.invalidParameters) {
    return <PageFrame><main id="conteudo" tabIndex={-1}><section id="catalogo" className="mx-auto max-w-[1160px] px-5 py-16 sm:px-8"><p className="font-mono text-xs font-medium tracking-[0.13em] text-[#1c7a4d]">CATÁLOGO</p><h1 className="mt-3 text-3xl font-bold tracking-[-0.04em]">Todas as lojas</h1><PageNotFound /></section></main></PageFrame>;
  }

  let catalog;
  try {
    catalog = await getCatalogPage(request);
  } catch {
    return <HomeError />;
  }

  const pageOutOfRange = catalog.total > 0 && request.page > catalog.totalPages;

  return (
    <PageFrame>
      <main id="conteudo" tabIndex={-1}>
        <section><div className="mx-auto max-w-[1160px] px-5 pt-14 pb-10 sm:px-8 sm:pt-20 sm:pb-12"><div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_auto]"><div><p className="font-mono text-xs font-medium tracking-[0.14em] text-[#1c7a4d]">{editorial.home.eyebrow}</p><h1 className="mt-5 max-w-2xl text-4xl font-bold leading-[1.03] tracking-[-0.055em] sm:text-6xl">{editorial.home.title}</h1><p className="mt-6 max-w-lg text-lg leading-8 text-[#5b5f56]">{editorial.home.description}</p><HeroSearch placeholder={editorial.home.searchPlaceholder} query={request.query} /></div><dl className="flex gap-4"><div className="flex-1 rounded-2xl border border-[#ece9e2] bg-white px-7 py-8 text-center"><dd className="font-numbers text-5xl font-bold leading-none text-[#1c7a4d]">{formatHeroStoreCount(catalog.total)}</dd><dt className="mt-2 text-sm text-[#5b5f56]">lojas</dt></div><div className="flex-1 rounded-2xl border border-[#ece9e2] bg-white px-7 py-8 text-center"><dd className="font-numbers text-5xl font-bold leading-none text-[#1c7a4d]">5</dd><dt className="mt-2 text-sm text-[#5b5f56]">plataformas</dt></div></dl></div></div></section>
        <section id="catalogo" className="mx-auto max-w-[1160px] px-5 pb-16 pt-4 sm:px-8"><div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4"><h2 className="text-3xl font-bold tracking-[-0.04em]">{request.query ? `Resultados para “${request.query}”` : "Todas as lojas"}</h2><div className="flex flex-wrap items-center gap-3"><CatalogControls query={request.query} sort={request.sort} /><span aria-hidden="true" className="h-5 w-px bg-[#e0ddd4]" /><InterToggle compact /></div></div>{catalog.total === 0 ? request.query ? <div className="mt-8 rounded-2xl border border-[#e0ddd4] bg-[#faf9f5] p-6"><h3 className="text-xl font-bold">Nenhuma loja com cashback disponível foi encontrada.</h3><p className="mt-2 text-[#5b5f56]">Tente outro nome ou limpe a busca para ver o catálogo completo.</p><Link className="mt-4 inline-flex font-semibold text-[#1c7a4d]" href="/#catalogo">Limpar busca</Link></div> : <div className="mt-8 rounded-2xl border border-[#e0ddd4] bg-[#faf9f5] p-6"><h3 className="text-xl font-bold">O catálogo está temporariamente vazio.</h3><p className="mt-2 text-[#5b5f56]">Isso pode indicar uma anomalia nos dados. Tente novamente em alguns instantes.</p></div> : pageOutOfRange ? <PageNotFound /> : <><div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{catalog.items.map((store) => <CatalogCard key={store.slug} store={store} />)}</div><Pagination request={request} totalPages={catalog.totalPages} /></>}</section>
      </main>
    </PageFrame>
  );
}
