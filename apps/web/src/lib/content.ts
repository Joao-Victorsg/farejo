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
