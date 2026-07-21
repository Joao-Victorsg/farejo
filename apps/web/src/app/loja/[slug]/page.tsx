import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { StoreHeader } from "@/components/store-header";
import { StoreHistory } from "@/components/store-history";
import { StoreRanking } from "@/components/store-ranking";
import { getStoreDetail, getStoreRedirect } from "@/lib/catalog";
import { getSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

interface StorePageProps {
  params: Promise<{ slug: string }>;
}

/**
 * Os três passos do handoff, nomeando a loja atual. Descrevem só o que o farejô de fato faz:
 * quem credita, com que prazo e por qual meio é sempre regra da plataforma escolhida (FAQ).
 */
function storeSteps(storeName: string) {
  return [
    { number: "01", title: "Escolha a plataforma", description: "Compare o cashback de cada plataforma e toque em Ativar na que pagar mais." },
    { number: "02", title: "Compre normalmente", description: `Você é redirecionado à ${storeName} pela plataforma escolhida. Compre como sempre.` },
    { number: "03", title: "Receba de volta", description: "O cashback é creditado na plataforma escolhida, seguindo os prazos e as formas de resgate dela." },
  ];
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

  return (
    <PageFrame>
      <main id="conteudo" tabIndex={-1}>
        <section className="mx-auto w-full max-w-[900px] px-5 py-9 pb-20 sm:px-10">
          <Link className="inline-flex min-h-11 items-center gap-2 text-sm text-[#5b5f56] hover:text-[#12140f] hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#1c7a4d]" href="/#catalogo"><ArrowLeft aria-hidden="true" size={17} />Todas as lojas</Link>
          <StoreHeader store={store} />
          {store.offers.length === 0 ? (
            <section className="mt-6 flex items-start gap-[18px] rounded-[18px] border border-[#ece9e2] bg-white p-6 sm:p-8" aria-labelledby="unavailable-heading">
              <span aria-hidden="true" className="flex size-[42px] shrink-0 items-center justify-center rounded-[11px] bg-[#f6efda] text-xl text-[#805e26]">⏸</span>
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.01em]" id="unavailable-heading">Sem ofertas no momento</h2>
                <p className="mt-1.5 max-w-[540px] leading-[1.55] text-[#5b5f56]">Nenhuma plataforma está com cashback ativo para {store.name} agora. Costuma ser temporário — as ofertas voltam quando as plataformas reabrem a loja. Você ainda pode acompanhar o histórico abaixo.</p>
              </div>
            </section>
          ) : (
            <StoreRanking store={store} />
          )}
          <StoreHistory store={store} />
          {store.offers.length > 0 ? (
            <section aria-labelledby="steps-heading" className="mt-11">
              <h2 className="mb-3.5 text-[15px] font-semibold text-[#5b5f56]" id="steps-heading">Como funciona</h2>
              <ol className="grid gap-4 sm:grid-cols-3">
                {storeSteps(store.name).map((step) => (
                  <li className="rounded-2xl border border-[#ece9e2] bg-white px-6 py-[22px]" key={step.number}>
                    <p className="font-mono text-xs font-medium tracking-[0.06em] text-[#1c7a4d]">{step.number}</p>
                    <h3 className="mt-3 text-[17px] font-semibold">{step.title}</h3>
                    <p className="mt-2 text-sm leading-[1.5] text-[#5b5f56]">{step.description}</p>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </section>
      </main>
    </PageFrame>
  );
}
