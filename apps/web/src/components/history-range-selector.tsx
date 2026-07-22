"use client";

import { useRef, type KeyboardEvent } from "react";
import type { HistoryRangeOption } from "@/lib/history";

/**
 * Régua de período do histórico. É escolha única entre opções mutuamente exclusivas, então o
 * papel é `radiogroup` com tabindex itinerante: botões soltos fariam o leitor de tela anunciar
 * N controles independentes em vez de uma escolha com N alternativas.
 *
 * As opções vêm derivadas do dado (`buildHistoryRangeOptions`) — este componente nunca inventa
 * um período que a loja não tem.
 */
export function HistoryRangeSelector({
  options,
  value,
  onChange,
}: {
  options: HistoryRangeOption[];
  value: string;
  onChange: (option: HistoryRangeOption) => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function select(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option);
    buttons.current[index]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1
      : 0;

    if (step !== 0) {
      event.preventDefault();
      select((index + step + options.length) % options.length);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      select(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      select(options.length - 1);
    }
  }

  return (
    <div
      aria-label="Período do histórico"
      className="inline-flex gap-0.5 rounded-[10px] border border-[#ddd9cf] bg-white p-0.5"
      role="radiogroup"
    >
      {options.map((option, index) => {
        const selected = option.id === value;
        return (
          <button
            aria-checked={selected}
            className={`inline-flex min-h-9 items-center rounded-[7px] px-3.5 text-[12.5px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1c7a4d] ${
              selected ? "bg-[#1c7a4d] font-medium text-white" : "text-[#3d4039] hover:bg-[#f6f5f0]"
            }`}
            key={option.id}
            onClick={() => onChange(option)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            role="radio"
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
