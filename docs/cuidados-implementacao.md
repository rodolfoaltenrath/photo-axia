# Cuidados de implementação

Comentários no código devem ser curtos e explicar restrições que não ficam
evidentes pelos nomes ou tipos. Contexto, justificativas, medições e planos
ficam em `docs/`. Contratos `# Safety` do Rust, atribuições de algoritmos e
diretivas de ferramentas devem permanecer nos arquivos correspondentes.

Esta organização não altera o comportamento do editor.

## Rust/WASM experimental

- A ABI pertence ao adaptador interno. Ainda não é o compositor do documento
  nem uma interface segura para ponteiros fornecidos por terceiros.
- Usar pares ponteiro/comprimento de alocações vivas de `axia_poc_alloc`;
  liberar cada alocação exatamente uma vez. A saída não pode sobrepor as
  entradas. Os testes de sobreposição não comprovam a validade de uma alocação.
- `axia_poc_alloc` retorna ponteiro nulo em caso de falha. Os passes usam os
  códigos abaixo; `axia_poc_free` não retorna status.

| Código | Significado |
| --- | --- |
| 0 | Sucesso |
| 1 | Comprimento, dimensão ou região inválida, conforme o passe |
| 2 | Opacidade, configuração ou efeito inválido |
| 3 | Ponteiro nulo |
| 4 | Região fora da fonte, no passe `fill_opacity_region` |
| 5 | Saída sobreposta a uma entrada, nos passes regionais |
| 6 | Orçamento/reserva de memória, no lote local, máscara alfa e sombra |

- Preservar precisão `f64`, ordem das operações e arredondamento do TS.
  Reassociação ou multiply-add fundido pode alterar os bytes de referência.
- Sobreposições usam a máscara original; Mesclar se da própria camada lê o
  raster já estilizado. RGB oculto e alfa zero têm regras diferentes entre
  preenchimento e filtros, cobertas pelos testes.
- Padrões usam coordenadas absolutas e coeficientes trigonométricos do TS.
  Diferenças minúsculas de trigonometria podem trocar o texel amostrado.
- Gradientes usam a grade inteira da fonte, não o centro de cada tile.
  Preservar a extrapolação TS após a última parada; alterá-la exige decisão
  separada de compatibilidade. Radial preserva a ordem do `hypot` de dois
  argumentos da referência JS; angular preserva centro, emenda e `%`.
  Testar paradas rígidas ao mudar toolchain/runtime, não só degradês suaves.
- Uma chamada WASM síncrona não é interrompida pelo cancelamento do Worker.
  O consumidor também deve rejeitar respostas ultrapassadas. Comandos de
  ciclo de vida da fonte são barreiras e não podem ser cancelados.
- Benchmarks dos passes não representam FPS do preview. As medições e seus
  limites estão na [prova Rust/WASM](prova-rust-wasm-c1.md).

O lote local preserva a máscara e materializa bytes entre passes; seu filtro
terminal não inclui Camada abaixo. O limite de 96 MiB inclui scratch, mas não
é o orçamento global do editor. Ver [contrato do lote](contrato-lote-local-v1.md).

A máscara alfa soma os raios de spread/blur ao contexto do tile e recorta só
depois dos passes. Spread é quadrado, não o traçado circular. Preservar divisor
fixo e arredondamento por eixo. Ver [contrato da máscara](contrato-mascara-alfa-v1.md).

Sombra usa índice global da grade para ruído, XOR assinado do TS, hash UTF-16
e cauda legada dos contornos customizados. Não limitar alfa antes da mesclagem.
Ver [contrato da sombra externa](contrato-sombra-externa-v1.md).

## Preview, texto e seleção

- O primeiro raster de texto estilizado precisa entrar no DOM antes de ficar
  ativo: seu evento `load` é necessário para completar o handoff.
- Texto é redesenhado na escala final da fonte, deixando só a distorção
  residual no `transform`. O caminho SVG de traçado é um subconjunto dos
  efeitos; os demais continuam no compositor.
- O preview de imagem só substitui a fonte quando possui pixels suficientes
  para o raster solicitado. A superfície do viewport respeita área visível,
  densidade e orçamento; não reserva um canvas do documento ampliado inteiro.
- Seleções compensam o zoom CSS externo nas medidas do contorno. Durante
  zoom, o contorno de pixels pode usar os limites da seleção e voltar ao
  desenho exato ao estabilizar. Contornos grandes não devem animar sem limite.
- A seleção rápida guarda apenas a fronteira pendente na fila. O fallback
  cooperativo divide o trabalho para permitir cancelamento e repintura.
- `sourceScaleFactor` é exato para escala uniforme; em escala não uniforme
  usa a média geométrica como aproximação, não uma conversão exata de círculos.

## Transformações e efeitos

- A aplicação de rotações aos pixels é serializada porque compartilha estado
  mutável do editor. A fila preserva mutações já pendentes, e a barreira inclui
  o trabalho para que undo/redo/exportação aguardem sua conclusão.
- A rotação de camada raster só é aplicada aos pixels ao confirmar, nunca
  durante o arraste. A transformação resultante volta a rotação zero.
- Transformações multicamadas partem do início da interação atual do ponteiro,
  não do estado inicial da sessão inteira de Ctrl+T.
- A dilatação circular do traçado usa a transformada de distância de
  Felzenszwalb/Huttenlocher; substituir por busca por disco em cada pixel muda
  o custo. O bisel aproxima a altura pelo alfa borrado e a modula por textura.
- O blur trata pixels externos como transparentes para preservar as bordas.
  A direção da máscara da sombra interna é oposta à projeção da sombra externa.
- Atualizar o cache raster de um PDF preserva a origem PDF e a transformação
  externa. PPI descreve densidade física e não altera pixels já calculados.
