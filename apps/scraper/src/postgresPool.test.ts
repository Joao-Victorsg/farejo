import { describe, expect, it } from "vitest";
import { resolvePostgresSsl } from "./postgresPool.js";

const REMOTE = "postgresql://farejo_logo_writer.ref:senha@aws-1-sa-east-1.pooler.supabase.com:6543/postgres";
const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CA = "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----";

describe("resolvePostgresSsl", () => {
  it("verifica a identidade do servidor quando o CA está configurado", () => {
    expect(resolvePostgresSsl(REMOTE, { FAREJO_SUPABASE_CA_CERT: CA })).toEqual({
      ca: CA,
      rejectUnauthorized: true,
    });
  });

  it("dispensa TLS no stack local, que não o oferece", () => {
    expect(resolvePostgresSsl(LOCAL, {})).toBeUndefined();
  });

  it("recusa host remoto sem CA em vez de degradar para conexão não verificada", () => {
    expect(() => resolvePostgresSsl(REMOTE, {})).toThrow(/FAREJO_SUPABASE_CA_CERT ausente/);
  });

  // `pg` deixa o parse da connection string sobrescrever o `ssl` explícito, e
  // `pg-connection-string` cria `ssl = {}` ao ver `sslmode` — o CA sumiria sem nenhum sinal.
  it("recusa sslmode na URL, que descartaria o CA em silêncio", () => {
    expect(() => resolvePostgresSsl(`${REMOTE}?sslmode=require`, { FAREJO_SUPABASE_CA_CERT: CA })).toThrow(
      /não pode conter `sslmode`/,
    );
    expect(() => resolvePostgresSsl(`${REMOTE}?application_name=x&sslmode=verify-full`, { FAREJO_SUPABASE_CA_CERT: CA })).toThrow(
      /não pode conter `sslmode`/,
    );
  });

  it("trata connection string ilegível como remota, que é o lado seguro", () => {
    expect(() => resolvePostgresSsl("nao-e-uma-url", {})).toThrow(/FAREJO_SUPABASE_CA_CERT ausente/);
  });
});
