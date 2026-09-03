# Roadmap — Ferramenta Forma

## Objetivo

Adicionar uma Ferramenta Forma no padrão do Photoshop: cada gesto cria uma camada vetorial própria, mantém geometria e aparência editáveis e só converte para pixels quando o usuário pede para rasterizar.

## Escopo funcional

- Formas iniciais: retângulo, elipse/superelipse, triângulo e estrela.
- Retângulo: raio dos cantos configurável em pixels, limitado automaticamente ao tamanho desenhado.
- Elipse: controle de `Quadratura` de 0% a 100%; 0% produz elipse/círculo e valores maiores aproximam uma superelipse de um quadrado arredondado.
- Triângulo: arredondamento dos três vértices em pixels.
- Estrela: cinco pontas por padrão, quantidade configurável de 3 a 32, profundidade interna e arredondamento configuráveis.
- A cor principal preenche a forma. Contorno fica fora da primeira entrega para manter a interface objetiva; será uma evolução compatível.
- O gesto funciona em qualquer direção dentro da área do documento.
- `Shift` restringe retângulo/elipse a proporções iguais e estrela/triângulo a uma caixa regular.
- `Alt` desenha a partir do centro; `Shift+Alt` combina os dois comportamentos.
- `Esc` cancela o gesto sem alterar pixels nem histórico.
- A forma é criada acima da camada ativa e passa a ser a nova camada selecionada.
- A seleção de pixels não recorta silenciosamente uma forma vetorial; máscaras vetoriais ficam para uma evolução própria.
- Cor, arredondamento, quadratura, pontas e profundidade continuam editáveis depois do `Enter`.
- `Ctrl+T`, mover, duplicar, reordenar, mesclar, exportar e rasterizar usam os mesmos fluxos das demais camadas.

## Decisões técnicas

- A decisão raster da primeira versão foi substituída após comparação com o Photoshop: o modo padrão agora cria uma camada de forma vetorial explícita.
- A geometria será independente do DOM e testável: normalização do gesto, modificadores, limites, vértices e caminhos arredondados.
- A prévia usa canvas limitado pela densidade visual; a camada confirmada usa caminho vetorial SVG no editor e Canvas 2D somente na exportação/achatamento.
- O conteúdo vetorial armazena a geometria base e os parâmetros da forma; posição, escala e rotação continuam em `LayerTransform`.
- Uma forma confirmada produz um delta `layers:add`; edições posteriores usam `layer:patch` agrupado e reversível.
- O formato `.axia` passa à versão 3 e continua aceitando projetos das versões 1 e 2.

## Etapas

- [x] Mapear ferramentas raster, barra contextual, interações do canvas, seleção, histórico e ciclo de previews.
- [x] Definir semântica raster, formas, parâmetros, modificadores e limites da primeira entrega.
- [x] Implementar o núcleo geométrico puro e testes das quatro formas.
- [x] Adicionar a Ferramenta Forma, seu grupo de formas e atalho `U` à barra lateral.
- [x] Criar controles contextuais de forma, cor, arredondamento, quadratura e pontas.
- [x] Implementar gesto de arraste, preview antialias e cancelamento.
- [x] Implementar composição raster assíncrona, seleção como máscara e expansão segura.
- [x] Integrar histórico, barreira de mutação, troca de ferramenta/camada e liberação de recursos.
- [x] Auditar lacunas, desempenho e acessibilidade.
- [x] Executar testes Go/frontend, TypeScript, Vite e gerar `bin/axia.exe`.
- [x] Migrar o comportamento padrão de raster na camada ativa para uma camada vetorial nova.
- [x] Integrar camada de forma a projeto, histórico, renderização, exportação, camada inteligente e rasterização explícita.

## Registro de implementação

### 2026-08-31 — Análise e contrato inicial

- Confirmado que Pincel, Borracha, Degradê e Balde usam uma barreira comum de mutação e registram imagem e transformação em uma ação atômica.
- Confirmado que o canvas já oferece matrizes consistentes entre documento, camada e raster e recorte compartilhado para todos os tipos de seleção.
- Definido que a ferramenta não criará uma nova camada automaticamente, respeitando a camada selecionada solicitada.
- Definido o nome `Quadratura` para o controle da elipse, com explicação acessível na interface, evitando expor o termo matemático `expoente de superelipse` ao usuário.
- Definido que o arredondamento usa pixels do documento, permanecendo previsível independentemente do zoom.
- Identificada a necessidade de limitar preview e raster definitivo separadamente para manter o gesto fluido sem perder qualidade no resultado final.

### 2026-08-31 — Núcleo geométrico

- Criados os contratos `ShapeKind`, `ShapeToolConfig` e `ShapeGeometry`, independentes da interface e do renderizador.
- Implementada normalização defensiva de cor, raio, quadratura, quantidade de pontas e profundidade da estrela.
- Implementada a caixa de arraste nos quatro sentidos, incluindo proporção restrita com `Shift` e desenho pelo centro com `Alt`.
- Implementados vértices de triângulo, estrela e superelipse e um traçador de polígonos com arredondamento limitado por aresta.
- O retângulo limita automaticamente o raio à metade da menor dimensão; estrela e triângulo limitam cada canto conforme as arestas vizinhas.
- Adicionados seis testes do núcleo; todos aprovados. `vue-tsc --noEmit`: aprovado.

### 2026-08-31 — Primeira fatia funcional

- Adicionada a Ferramenta Forma à barra lateral com atalho `U` e identificação acessível nos painéis.
- A barra contextual permite escolher retângulo, elipse, triângulo ou estrela, cor de preenchimento e os parâmetros específicos de cada geometria.
- Implementado arraste em qualquer direção, `Shift` para proporção igual, `Alt` para desenhar pelo centro e `Esc` para cancelar.
- A prévia usa canvas antialias limitado pela densidade visual e ocupa a posição real da camada na pilha de composição.
- A prévia permanece visível depois do `pointerup` até a imagem definitiva carregar, evitando o piscar entre gesto e commit.
- Criado Worker dedicado para decodificar, compor, recortar pela seleção, codificar PNG e gerar preview WebP sem bloquear a thread da interface.
- Sem seleção, o raster expande somente quando necessário e continua recortado ao documento; com seleção, os limites atuais da camada são preservados.
- Cada forma confirmada registra imagem e transformação em um único `layer:patch`; desfazer durante o processamento cancela o Worker sem atingir a ação anterior.
- `vue-tsc`, bundle Vite incluindo `shape.worker`, 343 testes do frontend e testes Go: aprovados.

### 2026-08-31 — Auditoria e build

- Restringido o início do gesto aos limites do documento; durante o arraste, a forma pode ultrapassar a borda e é recortada corretamente.
- Validado que formas com raio extremo, estrela de 32 pontas e quadratura máxima permanecem finitas e dentro da caixa geométrica.
- Confirmado que o preview respeita o orçamento de pixels e que seleções fragmentadas são processadas fora da thread principal.
- Corrigido o ciclo de handoff visual para conservar a prévia até o novo raster carregar ou limpar imediatamente em cancelamento/falha.
- Ajustado o ícone para usar a mesma cor clara das demais ferramentas e o painel de propriedades para exibir `Forma` em vez do identificador técnico.
- TypeScript, Vite 8 de desenvolvimento e produção, 343 testes do frontend e testes Go: aprovados.
- Executável atualizado em `bin/axia.exe`.

### 2026-08-31 — Ferramentas individuais por forma

- O grupo `U` da barra lateral foi dividido em Retângulo, Elipse, Triângulo e Estrela, cada um com ícone e entrada próprios.
- Clique simples mantém ativa a última forma usada; clique direito ou o indicador do canto abre todas as formas do grupo.
- A forma escolhida fica destacada no seletor e é lembrada ao alternar temporariamente para outra ferramenta.
- Removido da barra superior o seletor redundante de forma; ela agora mostra apenas cor e os parâmetros aplicáveis à ferramenta escolhida.
- Retângulo, Triângulo e Estrela exibem arredondamento; Elipse exibe quadratura; Estrela também exibe pontas e profundidade.
- `vue-tsc`, bundle Vite de produção, 343 testes do frontend e testes Go: aprovados; `bin/axia.exe` atualizado.

### 2026-09-03 — Sessão de forma editável

- [x] Manter a forma em prévia editável depois de soltar o mouse, sem gravar pixels imediatamente.
- [x] Exibir caixa de transformação para mover e redimensionar a forma antes da confirmação.
- [x] Aplicar alterações de cor, arredondamento, quadratura, pontas e profundidade à forma ainda pendente.
- [x] Confirmar toda a sessão como uma única ação com `Enter`, botão superior, clique fora da caixa no canvas ou troca de ferramenta; `Esc` cancela sem alterar a camada.
- [x] Reancorar o gesto ao alternar `Alt`, evitando saltos de tamanho e posição tanto na criação quanto no redimensionamento.
- [x] Cobrir a reancoragem por teste e repetir as validações automatizadas e o build.
- A caixa oferece oito alças e movimento pelo interior; cantos mantêm a proporção por padrão, `Shift` a libera durante o redimensionamento e `Alt` usa o centro.
- O alvo da camada é preservado durante a sessão e enviado explicitamente ao commit, evitando aplicar a forma sobre outra camada por engano.
- A barra superior exibe ações visíveis de `Confirmar` e `Cancelar`, além dos atalhos `Enter` e `Esc`.
- `vue-tsc`, 344 testes do frontend e testes Go: aprovados.

### 2026-09-03 — Limites reais após confirmação

- [x] Identificado que uma forma aplicada sobre camada transparente herdava o raster do documento inteiro, fazendo o `Ctrl+T` selecionar toda a área transparente.
- [x] Recortar o resultado confirmado aos pixels com alfa real, incluindo conteúdo anterior da camada e as bordas antialias da forma.
- [x] Transportar a origem do recorte para a transformação da camada, mantendo os pixels exatamente na mesma posição visual.
- [x] Processar a leitura de alfa em lotes limitados no Worker para evitar uma segunda cópia integral em documentos grandes e permitir cancelamento entre lotes.
- [x] Adicionar teste de regressão para dimensões e origem do raster recortado.
- `vue-tsc`, bundle Vite de produção, 345 testes do frontend e testes Go: aprovados; `bin/axia.exe` atualizado.

### 2026-09-03 — Migração para camada de forma vetorial

- [x] Substituir o commit raster sobre a camada ativa pela criação de uma nova camada `shape` acima dela.
- [x] Preservar a sessão anterior ao `Enter`, incluindo movimento, redimensionamento, `Alt`, `Shift`, confirmação e cancelamento.
- [x] Renderizar a forma como caminho SVG no editor, sem bitmap intermediário nem perda ao redimensionar.
- [x] Renderizar o mesmo caminho em Canvas 2D para exportação, miniaturas, amostragem, mesclagem e achatamento.
- [x] Manter parâmetros da forma editáveis na barra superior após a confirmação, com histórico agrupado por propriedade.
- [x] Integrar clonagem, duplicação, transformação, conversão em camada inteligente, exportação isolada e rasterização explícita.
- [x] Atualizar o projeto `.axia` para a versão 3, validar o conteúdo vetorial na leitura e manter compatibilidade com versões 1 e 2.
- [x] Remover Worker e serviço raster específicos da forma, reduzindo cópias RGBA, codificação PNG e uso de memória no fluxo normal.
- [x] Adicionar teste do caminho vetorial e teste de ida e volta da camada no projeto sem asset raster.
- O modo `Pixels`, equivalente ao modo opcional do Photoshop, permanece uma evolução futura explícita; não haverá rasterização silenciosa da camada selecionada.
- Validação concluída: `vue-tsc`, bundle Vite 8 de produção, 347 testes do frontend, testes Go e `git diff --check` aprovados.
- Executável de produção atualizado em `bin/axia.exe` (13.483.520 bytes; SHA-256 `EEAC16ADF1694C32C4009549AF37B09A2BCEF3A28A98A2E3AAFD29D74C795EC3`).
- Instalador NSIS atualizado em `bin/axia-amd64-installer.exe` (7.321.402 bytes; SHA-256 `AE2E397EF42B8544C717767D55364A060FEFD98911177B0A71307DA774DE2E44`).

## Validação manual posterior

- Desenhar cada forma nos quatro sentidos e em diferentes níveis de zoom.
- Combinar `Shift`, `Alt` e `Shift+Alt` durante o arraste.
- Testar arredondamento maior que formas pequenas e dimensões de um pixel.
- Testar superelipse em 0%, 50% e 100%, estrelas de 3, 5 e 32 pontas e diferentes profundidades.
- Criar formas acima de camadas raster, texto, inteligente e em documento transparente sem conteúdo raster.
- Depois do `Enter`, alterar cor e parâmetros, duplicar, reordenar, mover e usar `Ctrl+T` sem perda de nitidez.
- Confirmar `Esc`, troca de ferramenta, `Ctrl+Z`/`Ctrl+Shift+Z`, salvamento/reabertura `.axia` e exportação.
- Rasterizar explicitamente uma forma, converter uma ou várias formas em camada inteligente, mesclar e achatar.
- Estressar formas parcialmente fora do documento e transformações repetidas em zoom baixo e alto.
