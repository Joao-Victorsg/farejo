# Preferência do Inter fica no localStorage

## Contexto

O toggle global de correntista Inter começa ligado, precisa persistir no navegador e altera somente
a taxa e a ordem das ofertas dentro de cada loja. Ler essa preferência no servidor por cookie faria
o HTML variar por usuário, reduziria o aproveitamento do cache compartilhado e adicionaria uma
dimensão de personalização ao catálogo público.

## Decisão

A preferência é armazenada em `localStorage`. O HTML produzido pelo servidor sempre representa o
estado padrão, com correntista Inter ligado. Depois da hidratação, o navegador lê a preferência
salva e, quando ela estiver desligada, troca a taxa Inter e reordena localmente as ofertas já
recebidas pelo card ou pela página de loja.

A leitura da preferência não consulta o banco, não cria variante de cache, não usa cookie e não
bloqueia nem oculta o conteúdo inicial. Aceita-se uma reordenação única e breve após a hidratação
para um visitante recorrente cuja preferência salva seja diferente do padrão.

O componente deve preservar a marcação renderizada pelo servidor durante a hidratação e aplicar a
preferência persistida em uma atualização posterior, evitando divergência de hidratação. A ausência,
falha ou bloqueio do `localStorage` mantém o padrão ligado.

## Consequências

- O catálogo e as páginas de loja continuam compartilhando a mesma representação armazenável em
  cache para todos os visitantes.
- A interação é instantânea depois que os dados já chegaram e não dispara nova leitura no Supabase.
- Usuários recorrentes com o toggle desligado podem perceber uma pequena mudança de ordem após a
  hidratação.
- O estado não é sincronizado entre dispositivos ou navegadores, o que é compatível com a ausência
  de login.
- Testes de interface precisam cobrir primeiro acesso, preferência ligada, preferência desligada e
  indisponibilidade do armazenamento local.
