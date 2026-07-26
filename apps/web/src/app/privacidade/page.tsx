import type { Metadata } from "next";
import { PageFrame } from "@/components/page-frame";

// F4/#116 (ADR-0066) — rota pública, mas alcançável só pelo link que o bot manda: de propósito
// sem entrada em `navigation` (@/lib/content), então sem link no cabeçalho nem no rodapé.
export const metadata: Metadata = { title: "Privacidade" };

const sections = [
  {
    title: "O que guardamos",
    body: "O identificador da sua conversa com o bot no Telegram e as lojas que você escolher acompanhar. Nada de nome, sobrenome, @ ou o texto das suas mensagens — o bot descarta tudo isso antes de gravar qualquer coisa.",
  },
  {
    title: "Para que usamos",
    body: "Só para te avisar quando o cashback de uma loja que você acompanha melhorar. Não existe outro uso.",
  },
  {
    title: "Como apagar",
    body: "Envie /parar para o bot a qualquer momento. É uma eliminação de verdade, não uma marca de \"inativo\": a linha some do banco e não há como desfazer.",
  },
  {
    title: "Quando apagamos sozinhos",
    body: "Se você bloquear o bot ou sua conta do Telegram deixar de existir, apagamos os seus dados automaticamente — sem esperar você pedir.",
  },
  {
    title: "O que não fazemos",
    body: "Não vendemos nem compartilhamos esse dado com ninguém. Não medimos quem clicou em quê nem ligamos sua navegação no site à sua conta do Telegram.",
  },
];

export default function PrivacyPage() {
  return <PageFrame><main id="conteudo" className="mx-auto w-full max-w-[1160px] px-5 py-16 sm:px-8 sm:py-24"><p className="font-mono text-xs font-medium tracking-[0.13em] text-[#1c7a4d]">PRIVACIDADE</p><h1 className="mt-4 max-w-2xl text-4xl font-bold tracking-[-0.05em] sm:text-5xl">O que guardamos, para quê, e como apagar</h1><p className="mt-5 max-w-2xl text-lg leading-8 text-[#5b5f56]">Esta página descreve o único lugar do farejô que trata dado pessoal: o bot de avisos de cashback no Telegram. O site em si é anônimo — sem conta, sem cadastro, sem cookie.</p><dl className="mt-14 grid gap-4">{sections.map((section) => <div className="rounded-2xl border border-[#ece9e2] bg-white p-7" key={section.title}><dt className="text-xl font-bold tracking-[-0.03em]">{section.title}</dt><dd className="mt-3 max-w-3xl leading-7 text-[#5b5f56]">{section.body}</dd></div>)}</dl></main></PageFrame>;
}
