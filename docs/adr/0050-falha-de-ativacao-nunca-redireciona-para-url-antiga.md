# Falha de ativação nunca redireciona para URL antiga

## Contexto

A rota interna de ativação revalida a oferta antes do redirecionamento. Entre a renderização de uma
página em cache e o clique, a oferta pode ter sido encerrada, removida ou expirada. A validação também
pode falhar temporariamente por indisponibilidade do banco. Como o CTA abre uma nova aba, ambos os
casos precisam de uma saída compreensível dentro do farejô.

## Decisão

Se a combinação loja/plataforma existir, mas a oferta estiver inativa, removida ou além da janela de
frescor, `/go/[storeSlug]/[platformId]` responde `410` com a página “Esta oferta não está mais
disponível”. A página identifica a loja quando isso puder ser feito com segurança e oferece retorno
ao detalhe canônico para consultar as ofertas ainda vigentes.

Se a validação não puder ser concluída por timeout, conexão ou falha interna, a rota responde `503`
com a página “Não conseguimos validar esta oferta agora”. Ela oferece “Tentar novamente” e retorno
ao detalhe da loja. A tentativa respeita o mesmo limite e nunca reutiliza automaticamente um destino
anterior.

Oferta inexistente ou combinação forjada não revela dados operacionais e usa a apresentação segura
de indisponibilidade. Nenhum caso de falha redireciona diretamente para uma URL guardada no cliente,
na cache do catálogo ou em histórico antigo.

As duas páginas seguem o shell visual público, são acessíveis, não entram no sitemap e recebem
`noindex`. O handoff desktop precisa representar os dois estados.

## Consequências

- Uma página desatualizada não encaminha o usuário para uma oferta sabidamente inválida.
- Falha temporária não é apresentada como encerramento definitivo.
- O usuário sempre possui caminho de retorno para comparar alternativas.
- Monitoramento pode distinguir respostas `410`, `503` e redirects bem-sucedidos.
- O contrato de ativação continua seguro mesmo se JavaScript estiver desabilitado.
