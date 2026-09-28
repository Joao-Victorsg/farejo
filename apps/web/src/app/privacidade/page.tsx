import type { Metadata } from "next";
import { PageFrame } from "@/components/page-frame";
import { AnalyticsPreferencesButton } from "@/components/analytics-consent";

export const metadata: Metadata = { title: "Privacidade e cookies" };

const disclosureClass = "group border-t border-[#e8e6df] py-5 first:border-t-0";
const summaryClass = "flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold tracking-[-0.02em] marker:hidden [&::-webkit-details-marker]:hidden";
const contentClass = "mt-3 max-w-2xl space-y-3 text-sm leading-7 text-[#5b5f56]";

export default function PrivacyPage() {
  return (
    <PageFrame>
      <main id="conteudo" className="mx-auto w-full max-w-[800px] px-5 py-12 sm:px-8 sm:py-20">
        <p className="font-mono text-xs font-medium tracking-[0.13em] text-[#1c7a4d]">PRIVACIDADE</p>
        <h1 className="mt-3 text-3xl font-bold tracking-[-0.045em] sm:text-4xl">Privacidade e cookies</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-[#5b5f56]">
          Você pode comparar ofertas no farejô sem criar uma conta. Esta página explica, em linguagem direta, quais dados usamos nos recursos opcionais e como controlar suas escolhas.
        </p>

        <section aria-label="Resumo" className="mt-8 border-l-2 border-[#1c7a4d] pl-5 text-sm leading-7 text-[#353a32]">
          <p>Cookies de analytics são opcionais e só são ativados se você aceitar. Recusar não muda o funcionamento do site; você pode rever sua escolha quando quiser.</p>
        </section>

        <section className="mt-10" aria-labelledby="analytics-title">
          <h2 id="analytics-title" className="text-xl font-bold tracking-[-0.03em]">Cookies e estatísticas de uso</h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[#5b5f56]">
            Se você aceitar, o Google Analytics usa cookies para ajudar a entender quais páginas são acessadas e como as pessoas navegam pelo site. Medimos buscas sem registrar o texto pesquisado, páginas de lojas e redirecionamentos validados. Esses dados ajudam a orientar melhorias no site; não são usados para publicidade.
          </p>
          <details className={`${disclosureClass} mt-4`}>
            <summary className={summaryClass}>Ver detalhes sobre medição e cookies<span aria-hidden="true" className="text-[#1c7a4d] transition-transform group-open:rotate-180">⌄</span></summary>
            <div className={contentClass}>
              <p>O Google Analytics só é carregado depois do aceite. Os identificadores pseudônimos necessários para associar eventos à sessão consentida são enviados ao Google e não são mantidos nos registros do farejô. A navegação do site não é associada à conta do bot no Telegram.</p>
              <p>O farejô guarda sua escolha em um cookie próprio por até 180 dias. Depois do aceite, os cookies de analytics do Google são configurados para expirar após até 90 dias sem atividade. Ao revogar, interrompemos novos envios e removemos os cookies do Google que estão acessíveis no navegador.</p>
              <p>O período de retenção dos dados nos relatórios é definido pela configuração da propriedade do farejô no Google Analytics.</p>
            </div>
          </details>
        </section>

        <details className={disclosureClass}>
          <summary className={summaryClass}>Estatísticas agregadas e redirecionamentos<span aria-hidden="true" className="text-[#1c7a4d] transition-transform group-open:rotate-180">⌄</span></summary>
          <div className={contentClass}>
            <p>O Vercel Web Analytics é usado para estimar visitas e visualizar páginas de forma agregada. Ele não usa cookies, mas calcula visitantes com um hash temporário derivado da requisição, descartado após até 24 horas. Esse recurso não identifica diretamente a pessoa nem acompanha sua navegação entre sites.</p>
            <p>Para acompanhar os links, o farejô registra totais diários de redirecionamentos válidos, agrupados por loja e plataforma. Um redirecionamento significa que o farejô validou a oferta e enviou o navegador adiante; não confirma que a plataforma abriu, que houve compra ou que se trata de uma pessoa única. Uma mesma pessoa pode gerar mais de um acesso.</p>
          </div>
        </details>

        <details className={disclosureClass}>
          <summary className={summaryClass}>Avisos sobre ofertas divergentes<span aria-hidden="true" className="text-[#1c7a4d] transition-transform group-open:rotate-180">⌄</span></summary>
          <div className={contentClass}>
            <p>Se você usar o botão para avisar que um valor está diferente na plataforma, guardamos somente a loja, a plataforma, os valores anunciados e a versão da oferta. Não pedimos texto, conta nem identificador do visitante. Avisos repetidos sobre a mesma versão geram uma única pendência para revisão manual; um aviso não altera a oferta automaticamente.</p>
            <p>O serviço de proteção limita a frequência de envios por endereço IP. O farejô não grava esse endereço no registro do aviso.</p>
          </div>
        </details>

        <details className={disclosureClass}>
          <summary className={summaryClass}>Alertas pelo Telegram<span aria-hidden="true" className="text-[#1c7a4d] transition-transform group-open:rotate-180">⌄</span></summary>
          <div className={contentClass}>
            <p>Se você pedir alertas, guardamos o identificador da conversa no Telegram e as lojas escolhidas para enviar avisos sobre mudanças de cashback. Não guardamos o nome de perfil, o @ ou o histórico das mensagens para esse recurso.</p>
            <p>Use <code className="rounded bg-[#f3f2ed] px-1.5 py-0.5 text-[#353a32]">/parar &lt;loja&gt;</code> para remover uma loja da lista ou <code className="rounded bg-[#f3f2ed] px-1.5 py-0.5 text-[#353a32]">/parar</code> para encerrar os alertas e apagar o cadastro do bot.</p>
          </div>
        </details>

        <details className={disclosureClass}>
          <summary className={summaryClass}>Links para lojas e plataformas<span aria-hidden="true" className="text-[#1c7a4d] transition-transform group-open:rotate-180">⌄</span></summary>
          <div className={contentClass}>
            <p>Ao escolher uma oferta, você pode ser redirecionado para uma loja ou plataforma de cashback. Depois do redirecionamento, o uso de dados passa a seguir as regras e a política de privacidade do site de destino.</p>
          </div>
        </details>

        <section className="mt-8 border-t border-[#e8e6df] pt-6">
          <h2 className="text-lg font-bold tracking-[-0.03em]">Sua escolha</h2>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-[#5b5f56]">Você pode aceitar, recusar ou revogar os cookies opcionais sem perder acesso às páginas e ofertas do farejô.</p>
          <div className="mt-3 text-sm"><AnalyticsPreferencesButton /></div>
        </section>
      </main>
    </PageFrame>
  );
}
