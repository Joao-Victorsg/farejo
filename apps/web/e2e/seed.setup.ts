import { test } from "@playwright/test";
import type { Client } from "pg";
import { cleanFixtures, fixtureSlug, withDb } from "./db";
import { invalidateCatalog } from "./invalidate";

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date();
const delayedButFresh = new Date(now.getTime() - 30 * 60 * 60 * 1000); // dentro de 24-48h: "Atualização atrasada"

async function insertStore(client: Client, slug: string, name: string) {
  const { rows } = await client.query<{ id: number }>("insert into public.stores (slug, name) values ($1, $2) returning id", [slug, name]);
  const store = rows[0];
  if (!store) throw new Error(`Fixture store ${slug} was not inserted`);
  return store.id;
}

async function insertOffer(client: Client, storeId: number, options: {
  platformId: string;
  rewardType: "percent" | "fixed";
  value: number;
  valuePartial?: number | null;
  isUpto?: boolean;
  rawText: string;
  url: string;
  active?: boolean;
  lastSeenAt?: Date;
}) {
  await client.query(
    `insert into public.offers (store_id, platform_id, reward_type, value, value_partial, is_upto, raw_text, url, active, last_seen_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      storeId,
      options.platformId,
      options.rewardType,
      options.value,
      options.valuePartial ?? null,
      options.isUpto ?? false,
      options.rawText,
      options.url,
      options.active ?? true,
      options.lastSeenAt ?? now,
    ],
  );
}

async function insertHistory(
  client: Client,
  storeId: number,
  platformId: string,
  events: { daysAgo: number; rewardType?: "percent" | "fixed"; value: number | null; valuePartial?: number | null }[],
) {
  for (const event of events) {
    await client.query(
      `insert into public.offer_history (store_id, platform_id, reward_type, value, value_partial, changed_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [storeId, platformId, event.rewardType ?? "percent", event.value, event.valuePartial ?? null, new Date(now.getTime() - event.daysAgo * DAY_MS)],
    );
  }
}

/**
 * F3/T17: um conjunto pequeno de lojas reais cobrindo os estados representativos do handoff —
 * MELHOR+BOOST+ATÉ+ATRASADO+VALOR FIXO (alpha), loja de uma plataforma só + toggle Inter sem
 * boost (beta), loja indisponível (gamma, todas as ofertas inativas — resolve via
 * web_read.store_details que usa LEFT JOIN), e loja com ranking normal mas sem histórico
 * suficiente (delta). Roda como o projeto "seed", depois de "empty-state" já ter capturado o
 * catálogo genuinamente vazio.
 */
test("seed F3/T17 fixtures", async () => {
  await withDb(async (client) => {
    await cleanFixtures(client);

    const alphaSlug = fixtureSlug("alpha");
    const alphaId = await insertStore(client, alphaSlug, "Loja Alfa Cashback");
    await insertOffer(client, alphaId, { platformId: "meliuz", rewardType: "percent", value: 12, rawText: "12%", url: "https://www.meliuz.com.br/desconto/f3t17-alpha" });
    await insertOffer(client, alphaId, { platformId: "cuponomia", rewardType: "percent", value: 8, isUpto: true, rawText: "até 8%", url: "https://www.cuponomia.com.br/f3t17-alpha" });
    await insertOffer(client, alphaId, { platformId: "zoom", rewardType: "fixed", value: 30, rawText: "R$ 30", url: "https://www.zoom.com.br/f3t17-alpha" });
    await insertOffer(client, alphaId, { platformId: "mycashback", rewardType: "percent", value: 5, rawText: "5%", url: "https://www.mycashback.com.br/f3t17-alpha", lastSeenAt: delayedButFresh });
    // 47 dias a 8% seguidos de 8 dias a 12%: mediana ponderada = 8%, 12% >= 8% * 1,3 -> BOOST, "era 8%".
    await insertHistory(client, alphaId, "meliuz", [{ daysAgo: 55, value: 8 }, { daysAgo: 8, value: 12 }]);
    await insertHistory(client, alphaId, "cuponomia", [
      { daysAgo: 50, value: 6 },
      { daysAgo: 25, value: null },
      { daysAgo: 18, value: 7 },
      { daysAgo: 5, value: 8 },
    ]);
    await insertHistory(client, alphaId, "mycashback", [{ daysAgo: 20, value: 5 }]);
    await insertHistory(client, alphaId, "zoom", [
      { daysAgo: 55, rewardType: "fixed", value: 20 },
      { daysAgo: 5, rewardType: "fixed", value: 30 },
    ]);
    await client.query("insert into public.store_aliases (platform_id, raw_name, store_id) values ('meliuz', $1, $2)", ["Termo Único De Busca Testável", alphaId]);

    const betaSlug = fixtureSlug("beta");
    const betaId = await insertStore(client, betaSlug, "Loja Beta Solo");
    await insertOffer(client, betaId, { platformId: "inter", rewardType: "percent", value: 6, valuePartial: 2.2, rawText: "6%", url: "https://shopping.inter.co/site-parceiro/lojas/f3t17-beta" });
    // 35 dias a 5%/2% seguidos de 5 dias a 6%/2,2%: abaixo do fator de boost (1,3x) nas duas modalidades.
    await insertHistory(client, betaId, "inter", [{ daysAgo: 40, value: 5, valuePartial: 2 }, { daysAgo: 5, value: 6, valuePartial: 2.2 }]);

    const gammaSlug = fixtureSlug("gamma");
    const gammaId = await insertStore(client, gammaSlug, "Loja Gama Indisponível");
    await insertOffer(client, gammaId, { platformId: "inter", rewardType: "percent", value: 4, rawText: "4%", url: "https://shopping.inter.co/site-parceiro/lojas/f3t17-gamma", active: false });

    const deltaSlug = fixtureSlug("delta");
    const deltaId = await insertStore(client, deltaSlug, "Loja Delta Sem Histórico");
    await insertOffer(client, deltaId, { platformId: "cuponomia", rewardType: "percent", value: 9, rawText: "9%", url: "https://www.cuponomia.com.br/f3t17-delta" });
  });

  await invalidateCatalog();
});
