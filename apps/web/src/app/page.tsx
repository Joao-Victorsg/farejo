import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { CatalogCard } from "@/components/catalog-card";
import { CatalogControls } from "@/components/catalog-controls";
import { InterToggle } from "@/components/inter-toggle";
import { Button } from "@/components/ui/button";
import { CATALOG_PAGE_SIZE, catalogHref, getCatalogPage, parseCatalogRequest, type CatalogRequest } from "@/lib/catalog";
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

function Pagination({ request, totalPages }: { request: CatalogRequest; totalPages: number }) {
  if (totalPages < 2) return null;

  return (
    <nav aria-label="Paginação do catálogo" className="mt-10 flex flex-wrap items-center justify-center gap-2">
      {request.page > 1 ? <Link className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-[#e0ddd4] px-3 text-sm font-semibold" href={hrefForCatalog({ ...request, page: request.page - 1 })}><ArrowLeft aria-hidden="true" size={16} />Anterior</Link> : <span aria-disabled="true" className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-[#ece9e2] px-3 text-sm text-[#70736a]"><ArrowLeft aria-hidden="true" size={16} />Anterior</span>}
      {Array.from({ length: totalPages }, (_, index) => index + 1).map((candidate) => candidate === request.page ? <span aria-current="page" className="inline-flex size-10 items-center justify-center rounded-lg bg-[#1c7a4d] text-sm font-semibold text-white" key={candidate}>{candidate}</span> : <Link className="inline-flex size-10 items-center justify-center rounded-lg border border-[#e0ddd4] text-sm font-semibold" href={hrefForCatalog({ ...request, page: candidate })} key={candidate}>{candidate}</Link>)}
      {request.page < totalPages ? <Link className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-[#e0ddd4] px-3 text-sm font-semibold" href={hrefForCatalog({ ...request, page: request.page + 1 })}>Próxima<ArrowRight aria-hidden="true" size={16} /></Link> : <span aria-disabled="true" className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-[#ece9e2] px-3 text-sm text-[#70736a]">Próxima<ArrowRight aria-hidden="true" size={16} /></span>}
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
        <section className="border-b border-[#ece9e2] bg-[#faf9f5]"><div className="mx-auto max-w-[1160px] px-5 py-20 sm:px-8 sm:py-28"><p className="font-mono text-xs font-medium tracking-[0.13em] text-[#1c7a4d]">{editorial.home.eyebrow}</p><h1 className="mt-5 max-w-3xl text-4xl font-bold leading-[1.02] tracking-[-0.055em] sm:text-6xl">{editorial.home.title}</h1><p className="mt-6 max-w-xl text-lg leading-8 text-[#5b5f56]">{editorial.home.description}</p><Button asChild className="mt-8 gap-2"><Link href="#catalogo"><Search aria-hidden="true" size={17} />{editorial.home.cta}</Link></Button><dl className="mt-12 grid max-w-xl gap-3 sm:grid-cols-2"><div className="rounded-xl border border-[#ece9e2] bg-white p-4"><dt className="font-mono text-[11px] tracking-[0.12em] text-[#5b5f56]">LOJAS ELEGÍVEIS</dt><dd className="mt-1 font-mono text-2xl font-semibold text-[#1c7a4d]">{formatHeroStoreCount(catalog.total)}</dd></div><div className="rounded-xl border border-[#ece9e2] bg-white p-4"><dt className="font-mono text-[11px] tracking-[0.12em] text-[#5b5f56]">PLATAFORMAS</dt><dd className="mt-1 font-mono text-2xl font-semibold text-[#1c7a4d]">5</dd></div></dl></div></section>
        <section id="catalogo" className="mx-auto max-w-[1160px] px-5 py-16 sm:px-8"><p className="font-mono text-xs font-medium tracking-[0.13em] text-[#1c7a4d]">CATÁLOGO</p><h2 className="mt-3 text-3xl font-bold tracking-[-0.04em]">{request.query ? `Resultados para “${request.query}”` : "Todas as lojas"}</h2><p className="mt-4 max-w-2xl leading-7 text-[#5b5f56]">{request.sort === "platforms" ? "Ordenadas pela quantidade de plataformas com cashback verificado." : request.sort === "cashback" ? "Percentuais aparecem antes de valores fixos; cada unidade mantém sua própria ordem." : "Ordenadas pelo nome canônico da loja."}</p><CatalogControls query={request.query} sort={request.sort} /><div className="mt-3"><InterToggle /></div>{catalog.total === 0 ? request.query ? <div className="mt-8 rounded-2xl border border-[#e0ddd4] bg-[#faf9f5] p-6"><h3 className="text-xl font-bold">Nenhuma loja com cashback disponível foi encontrada.</h3><p className="mt-2 text-[#5b5f56]">Tente outro nome ou limpe a busca para ver o catálogo completo.</p><Link className="mt-4 inline-flex font-semibold text-[#1c7a4d]" href="/#catalogo">Limpar busca</Link></div> : <div className="mt-8 rounded-2xl border border-[#e0ddd4] bg-[#faf9f5] p-6"><h3 className="text-xl font-bold">O catálogo está temporariamente vazio.</h3><p className="mt-2 text-[#5b5f56]">Isso pode indicar uma anomalia nos dados. Tente novamente em alguns instantes.</p></div> : pageOutOfRange ? <PageNotFound /> : <><div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{catalog.items.map((store) => <CatalogCard key={store.slug} store={store} />)}</div><Pagination request={request} totalPages={catalog.totalPages} /><p aria-live="polite" className="mt-5 text-center text-sm text-[#5b5f56]">Página {catalog.page} de {catalog.totalPages} · {catalog.total} lojas elegíveis · {CATALOG_PAGE_SIZE} por página</p></>}</section>
      </main>
    </PageFrame>
  );
}
