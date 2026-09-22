# Correção da sincronização do preview

## 2026-09-14 — Investigação

- Identificada uma corrida entre a moldura da seleção, atualizada imediatamente, e o
  canvas auxiliar que prepara os pixels de forma assíncrona.
- O fluxo podia solicitar o raster original quando a prévia existente tinha resolução
  menor que o canvas auxiliar. Em imagens grandes, isso atrasava o primeiro quadro.
- A troca em buffer duplo também podia manter uma geometria antiga no raster visível
  enquanto o `Ctrl+T` já apresentava a geometria atual.

## 2026-09-14 — Implementação

- A movimentação da seleção passou a reutilizar primeiro o raster já decodificado e
  visível. Se ele não puder ser usado, a prévia leve tem prioridade e a imagem original
  permanece apenas como fallback.
- As linhas pontilhadas e a confirmação aguardam um primeiro quadro válido. O delta do
  ponteiro continua sendo acumulado e é aplicado assim que a prévia fica pronta.
- Falhas ou estados incompletos na preparação encerram a interação de forma limpa.
- Durante `Ctrl+T`, o raster visível acompanha a transformação mesmo quando uma nova
  prévia está carregando no buffer secundário. Fora da interação, a troca de fonte e
  geometria continua atômica.

## Validação automatizada

- 382 testes frontend aprovados.
- TypeScript (`vue-tsc --noEmit`) aprovado.
- Build Vite de produção aprovado.
- `git diff --check` aprovado; restam somente avisos de conversão LF/CRLF do ambiente.

## Validação manual aprovada — 2026-09-21

Estado final: `CONCLUÍDO — APTO PARA ARQUIVAMENTO`.

O mantenedor validou os fluxos de seleção e transformação; a sincronização do preview
permaneceu correta em uso prático.

- Importar uma imagem grande, selecionar parte dela e mover a seleção imediatamente.
- Redimensionar com `Ctrl+T`, confirmar e iniciar outra transformação enquanto a nova
  prévia é preparada.
- Repetir os dois fluxos com zoom baixo e alto e com uma camada que possua estilos.
