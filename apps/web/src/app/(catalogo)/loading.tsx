import { PageFrame } from "@/components/page-frame";

/**
 * Esqueleto do catálogo. Vive no route group `(catalogo)` — e NÃO na raiz de `app/` — para
 * envolver só a home (#101, ADR-0060).
 *
 * NÃO replicar em `/loja/[slug]` nem em `/plataformas`. Um `loading.tsx` cria uma fronteira de
 * Suspense no nível da rota, e o Next transmite este shell (status 200 já no fio) antes de a
 * página resolver — então `notFound()` e `permanentRedirect()` não conseguem mais definir o
 * status e degradam para 200 + `meta refresh`. Foi exatamente esse o soft-404 da #101.
 *
 * Duas razões para não haver esqueleto lá, na ordem em que importam: aquelas páginas resolvem
 * em 51–148ms medidos contra produção, então não há espera a preencher (a ADR-0060 tem a
 * tabela); e, se um dia houver, a fronteira vai ABAIXO da checagem de existência — `<Suspense>`
 * dentro da página, depois dos `await` que decidem 404/308 — nunca num `loading.tsx`.
 */
export default function HomeLoading() {
  return (
    <PageFrame>
      <main aria-hidden="true">
        <section className="border-b border-[#ece9e2] bg-[#faf9f5]"><div className="mx-auto max-w-[1160px] px-5 py-20 sm:px-8 sm:py-28"><div className="h-3 w-44 animate-pulse rounded bg-[#e0ddd4]" /><div className="mt-5 h-16 max-w-2xl animate-pulse rounded bg-[#ece9e2]" /><div className="mt-6 h-6 max-w-xl animate-pulse rounded bg-[#e0ddd4]" /></div></section>
        <section className="mx-auto max-w-[1160px] px-5 py-16 sm:px-8"><div className="h-3 w-24 animate-pulse rounded bg-[#e0ddd4]" /><div className="mt-4 h-10 w-56 animate-pulse rounded bg-[#ece9e2]" /><div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <div className="h-52 animate-pulse rounded-2xl border border-[#ece9e2] bg-[#faf9f5]" key={index} />)}</div></section>
      </main>
    </PageFrame>
  );
}
