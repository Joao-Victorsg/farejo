import { z } from "zod";

/**
 * Entrada/saída do classificador assistido de candidatos de alias (F3/T13, #59, ADR-0040).
 * `id` identifica o candidato (par de lojas) para alinhar a resposta ao lote enviado.
 */
export interface ClassifierCandidateInput {
  id: string;
  storeA: { canonicalSlug: string; name: string; platforms: string[] };
  storeB: { canonicalSlug: string; name: string; platforms: string[] };
  normalizedKeyA: string;
  normalizedKeyB: string;
  signal: "l3_exact" | "levenshtein";
  similarity: number;
}

export interface ClassifierVerdict {
  id: string;
  sameStore: boolean;
  confidence: number;
  explanation: string;
}

const ClassifierVerdictSchema = z.object({
  id: z.string().min(1),
  sameStore: z.boolean(),
  confidence: z.number().min(0).max(1),
  explanation: z.string().min(1),
});
const ClassifierResponseSchema = z.array(ClassifierVerdictSchema);

/**
 * Best-effort: falha, quota, resposta fora do schema ou indisponibilidade nunca lançam —
 * o chamador trata `null` como "sem opinião da IA para este lote" e segue só com as
 * heurísticas determinísticas (ADR-0039/ADR-0040). A resposta nunca é gravada no Supabase
 * nem interpretada como autorização de merge; só enriquece a proposta que vai para o PR.
 */
export type AliasClassifier = (candidates: ClassifierCandidateInput[]) => Promise<ClassifierVerdict[] | null>;

/**
 * Nenhum provedor está conectado hoje. GitHub Models — o provedor descrito na ADR-0040 —
 * foi desativado pela GitHub em 30/07/2026 (anúncio de retirada em 16/06/2026); a escolha
 * do próximo provedor best-effort fica para quando surgir uma opção gratuita viável, sem
 * mudar esta interface, o manifesto ou a regra de aprovação humana.
 */
export const disabledClassifier: AliasClassifier = async () => null;

/**
 * Wrapper de transporte genérico para um futuro provedor de classificação estruturada:
 * não depende de tipos de nenhum provedor específico (ADR-0040) — só de uma função capaz
 * de devolver JSON bruto a partir do lote de candidatos. Valida a resposta contra o schema
 * e descarta o lote inteiro (retorna `null`) se ela não vier no formato esperado.
 */
export function createHttpClassifier(requestJson: (candidates: ClassifierCandidateInput[]) => Promise<unknown>): AliasClassifier {
  return async (candidates) => {
    if (candidates.length === 0) return [];

    let raw: unknown;
    try {
      raw = await requestJson(candidates);
    } catch (error) {
      console.warn(`[curation] classificador de IA indisponível: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }

    const parsed = ClassifierResponseSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn(`[curation] resposta da IA fora do schema esperado, ignorando o lote: ${parsed.error.message}`);
      return null;
    }
    return parsed.data;
  };
}
