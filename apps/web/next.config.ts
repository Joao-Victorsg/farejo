import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `@farejo/postgres` (ADR-0055) é publicado como TypeScript-fonte, no mesmo padrão dos demais
  // pacotes do workspace — não há passo de build. É o primeiro pacote do workspace no caminho de
  // RUNTIME do site (`catalog.ts`/`activation.ts`), e sem isto o bundle da função serverless tenta
  // resolver `src/index.ts` sem loader. Era exatamente o risco que manteve as três cópias do helper
  // vivas até a #112.
  transpilePackages: ["@farejo/postgres"],
};

export default nextConfig;
