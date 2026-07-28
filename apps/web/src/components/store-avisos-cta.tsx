import { ExternalLink, Send } from "lucide-react";
import type { StoreDetail } from "@/lib/catalog";

const BOT_USERNAME = "farejocashbackbot";

function botStartUrl(slug: string) {
  return `https://t.me/${BOT_USERNAME}?start=${encodeURIComponent(slug)}`;
}

/**
 * Renderiza incondicionalmente (não depende de `store.offers.length`): a Inscrição não exige
 * oferta ativa agora, só a partir da próxima Melhoria (FAQ "Como funciona o aviso no Telegram?").
 */
export function StoreAvisosCta({ store }: { store: StoreDetail }) {
  return (
    <section className="mt-6 flex flex-wrap items-center gap-5 rounded-[18px] border border-[#ece9e2] bg-white p-6 sm:p-8" aria-labelledby="avisos-heading">
      <div className="flex flex-1 items-center gap-[18px]">
        <span aria-hidden="true" className="flex size-[52px] shrink-0 items-center justify-center rounded-[14px] bg-[#e7f4ec] text-[#1c7a4d]">
          <Send size={26} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[19px] font-bold tracking-[-0.01em]" id="avisos-heading">{`Avise-me quando o cashback da ${store.name} subir`}</h2>
          <p className="mt-1.5 max-w-[460px] text-[14.5px] leading-[1.55] text-[#5b5f56]">
            {`Receba uma mensagem no Telegram sempre que o cashback da ${store.name} `}
            <b className="font-semibold text-[#12140f]">subir ou passar de um valor definido por você</b>. Sem cadastro no farejô — o aviso chega direto no seu Telegram.
          </p>
        </div>
      </div>
      <a
        aria-label={`Ativar aviso no Telegram para ${store.name} (abre em nova aba)`}
        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-[11px] bg-[#1c7a4d] px-[22px] py-[13px] text-[15px] font-bold text-white hover:bg-[#16633f] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1c7a4d]"
        href={botStartUrl(store.slug)}
        rel="noopener noreferrer"
        target="_blank"
      >
        Ativar aviso no Telegram <ExternalLink aria-hidden="true" size={15} />
        <span className="sr-only">(abre em nova aba)</span>
      </a>
    </section>
  );
}
