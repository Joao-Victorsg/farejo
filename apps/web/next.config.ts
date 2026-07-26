import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `@farejo/postgres` (ADR-0055) tem build real desde o incidente do #120 (`main` aponta pra
  // `dist/`, compilado pelo `postinstall` da raiz) — este `transpilePackages` não é mais
  // obrigatório, fica como defesa em profundidade inofensiva contra o mesmo risco que manteve as
  // três cópias do helper vivas até a #112: o site é o primeiro pacote do workspace no caminho de
  // RUNTIME (`catalog.ts`/`activation.ts`), e um dia voltar a depender de transpilação implícita
  // sem essa entrada quebraria em silêncio.
  transpilePackages: ["@farejo/postgres"],
};

export default nextConfig;
