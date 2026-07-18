/**
 * Seleção pura de fonte de logo (F3/T15/#61, ADR-0014/ADR-0038). Recebe só as fontes já
 * validadas (imagem decodificada com sucesso) de um cluster canônico e decide qual delas
 * vira o logo final. Não baixa, não decodifica, não conhece Storage — isso é responsabilidade
 * do ingestor (apps/scraper/src/logos).
 */
export interface LogoSourceCandidate {
  platformId: string;
  width: number;
  height: number;
}

// Até 12% de diferença entre os lados ainda conta como "quadrada" — cobre folgas comuns de
// export dos sites (ex.: 128x120) sem deixar passar um banner qualquer.
const SQUARE_ASPECT_TOLERANCE = 0.12;

export function isSquareish(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false;
  const ratio = Math.min(width, height) / Math.max(width, height);
  return ratio >= 1 - SQUARE_ASPECT_TOLERANCE;
}

/**
 * Ordena: quadradas sempre antes de banners (ADR-0014 — "a imagem larga do MyCashback é
 * apenas fallback"), depois por maior resolução (lado menor, pra não premiar um banner
 * comprido). Empate residual é resolvido por `platformId` só para tornar o resultado
 * determinístico entre runs, sem significado de qualidade.
 */
export function pickBestLogoSource<T extends LogoSourceCandidate>(candidates: T[]): T | null {
  if (candidates.length === 0) return null;

  const ranked = [...candidates].sort((a, b) => {
    const squareA = isSquareish(a.width, a.height);
    const squareB = isSquareish(b.width, b.height);
    if (squareA !== squareB) return squareA ? -1 : 1;

    const minA = Math.min(a.width, a.height);
    const minB = Math.min(b.width, b.height);
    if (minA !== minB) return minB - minA;

    return a.platformId.localeCompare(b.platformId);
  });

  return ranked[0]!;
}
