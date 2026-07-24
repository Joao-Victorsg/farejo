import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { GeistMono } from "geist/font/mono";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/space-grotesk";
import "./globals.css";
import { InterPreferenceProvider } from "@/lib/inter-preference";
import { getSiteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: { default: "farejô — compare cashback", template: "%s | farejô" },
  description: "Compare o cashback disponível nas principais plataformas antes de comprar.",
  verification: { google: "6c5zstDoUHpXsV75EWqZ29gY-MaGvP3VnnISoinFqkM" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR" className={GeistMono.variable}><body><a className="skip-link" href="#conteudo">Pular para o conteúdo</a><InterPreferenceProvider>{children}</InterPreferenceProvider><Analytics /><SpeedInsights /></body></html>;
}
