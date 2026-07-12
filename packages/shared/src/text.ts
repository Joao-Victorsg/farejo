// \b não funciona depois de letra acentuada em JS ("Ativar até 10%" escapa /\bat[ée]\b/);
// remover acento ANTES do limite de palavra resolve.
export function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
