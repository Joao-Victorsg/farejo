type ActivationErrorKind = "unavailable" | "temporary";

interface ActivationErrorProps {
  kind: ActivationErrorKind;
  retryHref: string;
  storeHref: string;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;",
  })[character] ?? character);
}

export function activationErrorHtml({ kind, retryHref, storeHref }: ActivationErrorProps) {
  const temporary = kind === "temporary";
  const title = temporary ? "Não conseguimos validar esta oferta agora" : "Esta oferta não está mais disponível";
  const description = temporary
    ? "Tente novamente em alguns instantes. Não vamos abrir um destino que não conseguimos confirmar."
    : "A oferta pode ter sido encerrada ou não estar mais elegível. Consulte outras opções na loja.";
  const retry = temporary ? `<a class="primary" href="${escapeHtml(retryHref)}">Tentar novamente</a>` : "";

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} | farejô</title><style>
body{margin:0;min-width:320px;background:#fbfaf7;color:#12140f;font-family:Arial,sans-serif}header{border-bottom:1px solid #ece9e2;background:#fff}nav,section,footer{margin:auto;max-width:1160px;padding:1rem 2rem}nav{display:flex;justify-content:space-between;align-items:center}main section{max-width:760px;padding-top:5rem;padding-bottom:5rem}a{display:inline-flex;align-items:center;min-height:2.75rem;border-radius:.75rem;padding:0 1rem;color:#12140f;font-weight:700;text-decoration:none;border:1px solid #e0ddd4;background:#fff}.primary{border-color:#1c7a4d;background:#1c7a4d;color:#fff}.actions{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:2rem}.eyebrow{color:#805e26;font-size:.75rem;font-weight:700;letter-spacing:.13em}h1{font-size:2.25rem;letter-spacing:-.05em}p{color:#5b5f56;font-size:1.1rem;line-height:1.75}footer{max-width:none;background:#0d100e;color:#eef0ea;font-size:.875rem}@media(max-width:640px){nav,section,footer{padding-left:1.25rem;padding-right:1.25rem}}</style></head>
<body><header><nav aria-label="Navegação principal"><a href="/" style="border:0;padding:0;color:#1c7a4d;font-size:1.25rem">farejô</a><a href="/#catalogo" style="border:0;padding:0;color:#1c7a4d">Buscar loja</a></nav></header><main id="conteudo"><section aria-labelledby="activation-error-heading"><div class="eyebrow">ATIVAÇÃO</div><h1 id="activation-error-heading">${title}</h1><p>${description}</p><div class="actions">${retry}<a href="${escapeHtml(storeHref)}">Voltar para a loja</a></div></section></main><footer>O cashback é pago pela plataforma escolhida.</footer></body></html>`;
}
