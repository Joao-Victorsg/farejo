# Aceite visual desktop usa 1440 pixels

## Contexto

O handoff atualizado cobre desktop, enquanto as composições mobile foram adiadas pela ADR-0044. Sem
uma largura de referência, “alta fidelidade” poderia produzir comparações inconsistentes entre a
tela desenhada, snapshots automatizados e revisão humana.

## Decisão

O viewport canônico para comparação visual de alta fidelidade da primeira entrega é 1440 pixels de
largura. A altura do snapshot acompanha o conteúdo ou o recorte específico da tela validada.

Entre 1024 e 1439 pixels, o site precisa permanecer funcional, legível e sem corte ou rolagem
horizontal, preservando a estrutura desktop. Diferenças naturais de distribuição de espaço nesse
intervalo não são tratadas como divergência de pixel em relação ao snapshot de 1440 pixels.

Abaixo de 1024 pixels, a composição não participa do aceite visual desta entrega. O design de alta
fidelidade para essas larguras será definido no handoff mobile posterior.

## Consequências

- Revisões visuais usam uma referência reproduzível.
- Testes em 1024 e 1280 pixels verificam robustez do desktop, não igualdade com o snapshot de 1440.
- O container, a grade, o ranking e o gráfico não podem pressupor exclusivamente a largura máxima.
- O futuro aceite mobile terá referências próprias e não altera retroativamente o baseline desktop.
