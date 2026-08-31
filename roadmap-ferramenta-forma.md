# Roadmap — Ferramenta Forma

## Objetivo

Adicionar uma Ferramenta Forma raster que desenha diretamente sobre a camada selecionada, com prévia interativa, antialiasing, respeito à seleção ativa e uma única etapa de histórico por forma confirmada.

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
- Se existir uma seleção, ela atua como máscara e permanece ativa depois da aplicação.
- Sem seleção, a camada raster pode se expandir somente até os limites visíveis do documento.
- A ferramenta atua em camadas de imagem, fundo ou pixels. Camadas vazias de fundo/pixels são materializadas automaticamente; texto, ajuste e camada inteligente não são rasterizados silenciosamente.

## Decisões técnicas

- A primeira versão é raster porque o requisito é desenhar na camada selecionada; ela não criará uma camada vetorial escondida nem alterará o formato `.axia`.
- A geometria será independente do DOM e testável: normalização do gesto, modificadores, limites, vértices e caminhos arredondados.
- A prévia usará canvas limitado pela densidade visual, enquanto a confirmação será processada fora da thread principal para documentos grandes.
- A composição reutilizará matrizes de camada e recorte de seleção já utilizados por Pincel e Degradê, inclusive para camadas escaladas ou rotacionadas.
- O resultado definitivo será PNG, com preview WebP derivado e ciclo de entrega visual sem piscar a camada anterior.
- Uma forma confirmada produzirá um delta `layer:patch` atômico; `Ctrl+Z` restaura imagem e transformação juntas.

## Etapas

- [x] Mapear ferramentas raster, barra contextual, interações do canvas, seleção, histórico e ciclo de previews.
- [x] Definir semântica raster, formas, parâmetros, modificadores e limites da primeira entrega.
- [x] Implementar o núcleo geométrico puro e testes das quatro formas.
- [ ] Adicionar a Ferramenta Forma, seu grupo de formas e atalho `U` à barra lateral.
- [ ] Criar controles contextuais de forma, cor, arredondamento, quadratura e pontas.
- [ ] Implementar gesto de arraste, preview antialias e cancelamento.
- [ ] Implementar composição raster assíncrona, seleção como máscara e expansão segura.
- [ ] Integrar histórico, barreira de mutação, troca de ferramenta/camada e liberação de recursos.
- [ ] Auditar lacunas, desempenho e acessibilidade.
- [ ] Executar testes Go/frontend, TypeScript, Vite e gerar `bin/axia.exe`.

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

## Validação manual posterior

- Desenhar cada forma nos quatro sentidos e em diferentes níveis de zoom.
- Combinar `Shift`, `Alt` e `Shift+Alt` durante o arraste.
- Testar arredondamento maior que formas pequenas e dimensões de um pixel.
- Testar superelipse em 0%, 50% e 100%, estrelas de 3, 5 e 32 pontas e diferentes profundidades.
- Aplicar sobre camada rotacionada/escalada e com seleção retangular, elíptica, laço e Varinha.
- Confirmar `Esc`, troca de ferramenta, `Ctrl+Z`/`Ctrl+Shift+Z`, salvamento e exportação.
- Estressar documento de 64 MP e formas parcialmente fora do documento.
