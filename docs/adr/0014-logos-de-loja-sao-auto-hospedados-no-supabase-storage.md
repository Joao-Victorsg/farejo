# Logos de loja são auto-hospedados no Supabase Storage

## Contexto

Cada plataforma já fornece alguma imagem para as lojas que anuncia, mas essas URLs não são um
contrato de distribuição para o farejô. O POC encontrou tipos MIME inadequados, políticas de cache
inconsistentes, imagens privadas e formatos pouco apropriados para a interface. Fazer hotlink também
deixaria a apresentação sujeita a bloqueios por origem, mudanças de URL e indisponibilidade de
terceiros.

Ao mesmo tempo, descobrir o logo diretamente no site oficial de cada lojista exigiria primeiro
resolver e validar seu domínio canônico, além de criar um novo crawler com qualidade irregular.
Serviços externos de logos adicionariam custo, atribuição e dependência de fornecedor. As cinco
plataformas já conhecidas são, portanto, boas fontes de descoberta, mas não devem ser a origem de
entrega das imagens no frontend.

## Decisão

Os logos fixos das cinco plataformas ficam versionados no Git em
`apps/web/public/portals/*.svg`. Logos de lojas seguem um fluxo separado:

1. as URLs encontradas nas plataformas são registradas como fontes operacionais privadas;
2. o processo de ingestão baixa o melhor candidato disponível somente de origens HTTPS permitidas;
3. o conteúdo é limitado por tamanho e tempo, decodificado como imagem real, normalizado para WebP
   quadrado de aproximadamente 128 px e tem metadados desnecessários removidos;
4. o resultado é gravado em bucket público do Supabase Storage com caminho imutável e endereçado
   pelo conteúdo, por exemplo `store-logos/{store_id}/{sha256}.webp`;
5. somente depois do upload bem-sucedido o ponteiro do logo da loja canônica é atualizado;
6. o frontend lê apenas esse ponteiro final e nunca carrega a imagem diretamente de uma plataforma.

Há um logo final por loja canônica, não por oferta. A seleção prefere fontes quadradas e de maior
qualidade entre todas as plataformas presentes no cluster de aliases; a imagem larga do MyCashback
é apenas fallback. Se nenhuma fonte válida existir, a interface mostra o tile com a inicial da loja.

Os metadados das fontes — plataforma, URL original, ETag ou `Last-Modified` quando houver, hash,
estado e data de verificação — não entram no contrato público. O bucket permite leitura pública dos
arquivos finais, pois eles são conteúdo público do site, mas upload, troca e exclusão permanecem
restritos ao processo autorizado. Nenhuma credencial de escrita chega ao navegador.

Um domínio oficial poderá futuramente fornecer um override curado. Ele não será requisito nem fonte
automática primária da primeira entrega. APIs comerciais de logos também não fazem parte da
dependência operacional da Fase 3.

## Consequências

- A disponibilidade e o cache dos logos deixam de depender do runtime das plataformas comparadas.
- Caminhos com hash evitam servir bytes antigos pela CDN ou pelo cache do navegador após uma troca.
- A atualização publica um novo objeto antes de trocar o ponteiro, evitando uma janela com imagem
  ausente.
- A curadoria de aliases repercute na seleção do logo: todas as fontes do cluster podem disputar o
  único logo da loja canônica.
- Fontes quebradas ou inseguras afetam somente a ingestão; o último logo válido continua publicado.
- O Storage contém os binários normalizados, enquanto os metadados privados permitem revalidação,
  diagnóstico e escolha de uma fonte alternativa sem expor esse inventário no frontend.
