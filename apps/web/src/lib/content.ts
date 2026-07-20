export const navigation = [
  { href: "/", label: "Lojas" },
  { href: "/plataformas", label: "Plataformas" },
  { href: "/como-funciona", label: "Como funciona" },
  { href: "/faq", label: "FAQ" },
] as const;

export const howItWorks = [
  {
    number: "01",
    title: "Encontre uma loja",
    description: "Pesquise a loja em que você pretende comprar para ver as ofertas disponíveis.",
  },
  {
    number: "02",
    title: "Compare as plataformas",
    description: "Veja o cashback de cada plataforma e escolha a opção que fizer mais sentido para você.",
  },
  {
    number: "03",
    title: "Ative e compre normalmente",
    description: "A ativação abre a plataforma escolhida. A compra e o cashback seguem as regras dela.",
  },
] as const;

export const faqs = [
  {
    question: "Quem paga o cashback?",
    answer: "O cashback é pago pela plataforma escolhida, não pelo farejô. Ela recebe uma comissão da loja e pode repassar uma parte a você.",
  },
  {
    question: "O farejô cobra alguma coisa?",
    answer: "Não. O farejô é gratuito: ele compara as ofertas disponíveis e direciona você à plataforma escolhida.",
  },
  {
    question: "Por que os valores variam?",
    answer: "Cada plataforma negocia suas próprias condições com as lojas. Campanhas, categorias e regras também podem alterar o cashback exibido.",
  },
  {
    question: "Como recebo o cashback?",
    answer: "O crédito acontece na plataforma usada para ativar a compra, seguindo os prazos e formas de resgate definidos por ela.",
  },
  {
    question: "Preciso criar uma conta no farejô?",
    answer: "Não. O farejô não pede cadastro. Você só precisa atender às regras da plataforma escolhida para receber o cashback.",
  },
] as const;

export const platforms = ["Méliuz", "Cuponomia", "MyCashback", "Zoom", "Inter"] as const;

export const editorial = {
  home: { eyebrow: "COMPARE · ESCOLHA · ECONOMIZE", title: "Antes de comprar, veja quem paga mais cashback.", description: "O farejô compara Méliuz, Cuponomia, MyCashback, Zoom e Inter em cada loja — e mostra quem paga mais na hora.", cta: "Buscar uma loja", searchPlaceholder: "Busque uma loja — ex: Amazon, Shopee, Magalu…", catalogEyebrow: "CATÁLOGO", catalogTitle: "Em preparação", catalogDescription: "O catálogo público será conectado às ofertas verificadas na próxima etapa. Não exibimos lojas, valores ou estatísticas demonstrativas.", catalogCta: "Entenda como funciona" },
  how: { eyebrow: "COMO FUNCIONA", title: "Como o farejô funciona", description: "Você compara, escolhe e ativa. A compra segue normalmente na loja e o cashback continua sendo responsabilidade da plataforma escolhida.", ctaTitle: "Ainda tem dúvidas?", ctaDescription: "Veja respostas sobre cadastro, valores e recebimento.", cta: "Ir para a FAQ" },
  faq: { eyebrow: "FAQ", title: "Perguntas frequentes", description: "O farejô compara ofertas. As plataformas são responsáveis pela ativação, pagamento e regras do cashback.", ctaTitle: "Pronto para comparar?", ctaDescription: "Não há cadastro no farejô.", cta: "Buscar uma loja" },
  platforms: { eyebrow: "AS FONTES QUE COMPARAMOS", title: "Plataformas de cashback", description: "Reunimos o cashback dessas plataformas em cada loja. Aqui está o panorama de cada uma: cobertura, média anunciada e pico. Estatísticas do Inter usam sempre a taxa de correntista." },
  footer: { slogan: "Compare cashback antes de comprar e escolha a plataforma que melhor recompensa você.", product: "PRODUTO", help: "AJUDA", disclaimer: "O cashback é pago pela plataforma escolhida e pode estar sujeito às regras dela." },
} as const;
