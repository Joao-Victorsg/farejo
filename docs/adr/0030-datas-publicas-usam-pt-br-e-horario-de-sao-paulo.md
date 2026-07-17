# Datas públicas usam pt-BR e horário de São Paulo

## Contexto

O banco registra instantes absolutos, enquanto a interface precisa comunicar frescor de forma
imediata para um público brasileiro. Textos vagos como “atualizado hoje” podem esconder ofertas com
idades muito diferentes e ficam incorretos em páginas mantidas abertas ou servidas de cache.

## Decisão

Instantes são persistidos como `timestamptz` em UTC. A apresentação pública usa locale `pt-BR` e o
fuso `America/Sao_Paulo` para datas civis.

O resumo de frescor da loja continua usando o menor `last_seen_at` entre as ofertas exibidas. Sua
forma relativa segue:

- menos de 1 hora: `Atualizado há N min`;
- de 1 hora até menos de 24 horas: `Atualizado há N h`;
- de 24 até 48 horas: `Verificação atrasada há N h`.

Ofertas acima de 48 horas deixam o conjunto público conforme a ADR-0015. Quando houver plataformas
em idades diferentes, a sinalização específica continua identificando quais estão atrasadas.

O texto relativo é recalculado no cliente a partir do timestamp recebido, sem nova consulta, para
não congelar durante uma sessão longa ou por causa da cache. O HTML usa elemento `time` com o instante
exato disponível em formato de máquina e alternativa compreensível.

Datas absolutas do gráfico, validade verdadeira e outros marcos usam `dd/MM/yyyy` quando o ano for
necessário. Toda formatação passa por `Intl.DateTimeFormat` ou `Intl.RelativeTimeFormat`; strings não
são montadas manualmente.

## Consequências

- A interface não depende da timezone do runtime da Vercel nem da configuração local do banco.
- Frescor continua correto enquanto a página permanece aberta, sem invalidar a cache por minuto.
- Leitores de tela e interações de detalhe podem acessar data e hora exatas além do texto relativo.
- Testes de formatação fixam timezone e instante para não variar conforme a máquina que os executa.
- Viradas de dia e horário de verão histórico são responsabilidade das APIs de internacionalização,
  não de cálculos manuais.
