import dns from "node:dns/promises";
import net from "node:net";
import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from "undici";

/**
 * SSRF-safe download (F3/T15/#61, ADR-0014). Toda fonte de logo é uma URL descoberta em
 * plataformas de terceiros — nunca confiável. `safeFetchBytes` valida protocolo e endereço
 * ANTES de conectar, e fixa a conexão no endereço já validado (via `lookup` customizado do
 * `undici`) para que uma segunda resolução de DNS no momento do connect não possa apontar
 * para outro lugar (DNS rebinding). Cada hop de redirect passa pela mesma validação — um
 * primeiro endereço público não autoriza um Location subsequente.
 */
export class UnsafeUrlError extends Error {}
export class DownloadTooLargeError extends Error {}

export interface SafeFetchOptions {
  /** Default: só HTTPS. Testes injetam `["http:"]` contra um servidor local controlado. */
  allowedProtocols?: string[];
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  userAgent?: string;
  /**
   * Default: `resolveValidatedAddresses` real. Testes injetam um resolver que trata o
   * servidor local (normalmente loopback, sempre bloqueado pela regra real) como o único
   * endereço confiável do cenário — a mesma forma de negar tudo mais, só trocando "IP
   * público" por "IP do servidor controlado do teste". A lógica de redirect/tamanho/tempo
   * exercitada continua sendo a de produção; só a fonte de confiança do endereço muda.
   */
  resolveAddress?: (hostname: string) => Promise<ValidatedAddress[]>;
}

export interface SafeFetchResult {
  bytes: Buffer;
  contentType: string | null;
  finalUrl: string;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_USER_AGENT = "farejo-logo-ingest/1.0 (+https://github.com/Joao-Victorsg/farejo)";

function stripBrackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function isPublicIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const a = parts[0]!;
  const b = parts[1]!;
  const c = parts[2]!;
  if (a === 0) return false; // "esta rede" (RFC 791)
  if (a === 10) return false; // RFC 1918
  if (a === 127) return false; // loopback
  if (a === 169 && b === 254) return false; // link-local (RFC 3927)
  if (a === 172 && b >= 16 && b <= 31) return false; // RFC 1918
  if (a === 192 && b === 168) return false; // RFC 1918
  if (a === 192 && b === 0 && c === 0) return false; // atribuições de protocolo IETF
  if (a === 192 && b === 0 && c === 2) return false; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking (RFC 2544)
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT compartilhado (RFC 6598)
  if (a >= 224) return false; // multicast (224-239) + reservado/broadcast (240-255)
  return true;
}

// IPv6: cobertura best-effort dos ranges não roteáveis mais relevantes (loopback, link-local,
// unique-local, multicast) e do mapeamento IPv4-in-IPv6. Não é uma implementação completa da
// IANA IPv6 Special-Purpose Registry — suficiente para o risco real (URLs de logo de terceiros).
function isPublicIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return false;

  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIPv4(mapped[1]!);

  const firstGroup = normalized.split(":")[0] ?? "";
  const firstHextet = firstGroup === "" ? 0 : parseInt(firstGroup, 16);
  if (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) return false; // link-local fe80::/10
  if (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) return false; // unique-local fc00::/7
  if (firstHextet >= 0xff00 && firstHextet <= 0xffff) return false; // multicast ff00::/8
  return true;
}

export function isPublicRoutableAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPublicIPv4(ip);
  if (family === 6) return isPublicIPv6(ip);
  return false;
}

export interface ValidatedAddress {
  address: string;
  family: 4 | 6;
}

/**
 * Resolve o host e recusa a URL inteira se QUALQUER endereço retornado não for público —
 * nunca "escolhe em volta" de um registro privado (isso reabriria o truque de múltiplos
 * registros A/AAAA para SSRF). Endereço literal na URL pula o DNS e é validado direto.
 *
 * Devolve TODOS os endereços validados, não só o primeiro: como a validação é tudo-ou-nada,
 * o conjunto inteiro é tão confiável quanto qualquer elemento dele, e entregá-lo completo ao
 * `connect` deixa o Node escolher um endereço com rota (Happy Eyeballs). Fixar `records[0]`
 * quebrava host cujo primeiro registro é AAAA em runner sem rota IPv6 — como o do GitHub
 * Actions, onde este ingestor roda.
 */
export async function resolveValidatedAddresses(hostname: string): Promise<ValidatedAddress[]> {
  const bareHost = stripBrackets(hostname);
  const literalFamily = net.isIP(bareHost);

  const records = literalFamily
    ? [{ address: bareHost, family: literalFamily }]
    : await dns.lookup(bareHost, { all: true, verbatim: true });

  if (records.length === 0) throw new UnsafeUrlError(`DNS não resolveu nenhum endereço para ${hostname}`);

  const unsafe = records.find((r) => !isPublicRoutableAddress(r.address));
  if (unsafe) {
    throw new UnsafeUrlError(`Endereço não roteável publicamente resolvido para ${hostname}: ${unsafe.address}`);
  }

  return records.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : (4 as const) }));
}

async function readBoundedBody(response: UndiciResponse, maxBytes: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new DownloadTooLargeError(`Corpo da resposta excede o limite de ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Baixa `url` com validação de SSRF em cada hop, cap de tamanho/tempo e redirect manual. */
export async function safeFetchBytes(url: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const allowedProtocols = options.allowedProtocols ?? ["https:"];
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const resolveAddress = options.resolveAddress ?? resolveValidatedAddresses;

  let currentUrl = url;

  for (let hop = 0; ; hop++) {
    const parsed = new URL(currentUrl);
    if (!allowedProtocols.includes(parsed.protocol)) {
      throw new UnsafeUrlError(`Protocolo não permitido em ${currentUrl}: ${parsed.protocol}`);
    }

    const validated = await resolveAddress(parsed.hostname);
    const agent = new Agent({
      connect: {
        // O `lookup` do Node tem DUAS formas de resposta e a escolha é de quem chama, não
        // nossa: com `autoSelectFamily` (padrão desde o Node 20) ele pede `{ all: true }` e
        // espera um ARRAY de `{ address, family }`; sem isso, espera a tripla
        // `(err, address, family)`. Responder a tripla para um pedido `all` faz o Node ler
        // `addresses[0].address` como `undefined` e abortar com ERR_INVALID_IP_ADDRESS —
        // foi o que reprovou 100% dos downloads de logo em produção (F3/T15, ADR-0057).
        lookup: (_hostname, opts, callback) => {
          if (opts?.all) {
            callback(null, validated);
            return;
          }
          const first = validated[0]!;
          callback(null, first.address, first.family);
        },
      },
    });

    try {
      const response = await undiciFetch(currentUrl, {
        redirect: "manual",
        dispatcher: agent,
        headers: { "user-agent": userAgent },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new UnsafeUrlError(`Redirect sem Location em ${currentUrl}`);
        if (hop >= maxRedirects) throw new UnsafeUrlError(`Excesso de redirects a partir de ${url} (máximo ${maxRedirects})`);
        currentUrl = new URL(location, currentUrl).href;
        continue;
      }

      if (!response.ok) throw new Error(`HTTP ${response.status} em ${currentUrl}`);

      const contentLength = response.headers.get("content-length");
      if (contentLength && Number(contentLength) > maxBytes) {
        throw new DownloadTooLargeError(`Content-Length ${contentLength} excede o limite de ${maxBytes} bytes`);
      }

      const bytes = await readBoundedBody(response, maxBytes);
      return { bytes, contentType: response.headers.get("content-type"), finalUrl: currentUrl };
    } finally {
      // `destroy` (não `close`): o agent é de uso único por hop — `close` esperaria a
      // resposta terminar de drenar, o que trava quando saímos cedo (ex.: Content-Length
      // declarado maior que o corpo real de fato enviado) e o corpo nunca é consumido.
      await agent.destroy();
    }
  }
}
