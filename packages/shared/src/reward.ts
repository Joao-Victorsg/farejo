import { stripAccents } from "./text.js";

export type Reward =
  | { type: "percent"; value: number; isUpto: boolean }
  | { type: "fixed"; value: number; currency: "BRL" };

export class ParseError extends Error {
  constructor(rawText: string) {
    super(`texto de reward não reconhecido: "${rawText}"`);
    this.name = "ParseError";
  }
}

function brNum(raw: string): number {
  return Number.parseFloat(raw.replace(",", "."));
}

function firstCapture(re: RegExp, text: string): string | undefined {
  return re.exec(text)?.[1];
}

const FIXED_RE = /R\$\s*(\d+(?:[.,]\d+)?)/;
const PERCENT_RE = /(\d+(?:[.,]\d+)?)\s*%/;
const UP_TO_RE = /\bate\b/;

export function parseReward(text: string): Reward {
  const rawFixed = firstCapture(FIXED_RE, text);
  if (rawFixed !== undefined) {
    return { type: "fixed", value: brNum(rawFixed), currency: "BRL" };
  }

  const rawPercent = firstCapture(PERCENT_RE, text);
  if (rawPercent !== undefined) {
    return {
      type: "percent",
      value: brNum(rawPercent),
      isUpto: UP_TO_RE.test(stripAccents(text.toLowerCase())),
    };
  }

  throw new ParseError(text);
}
