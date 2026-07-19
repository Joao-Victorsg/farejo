import { PageFrame } from "@/components/page-frame";

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
