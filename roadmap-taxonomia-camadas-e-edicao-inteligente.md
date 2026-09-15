# Taxonomia de camadas e edição de Objetos Inteligentes

## Decisão de produto

O Axia passa a apresentar os mesmos conceitos principais do Photoshop, sem expor
diferenças internas do motor:

- **Camada de pixels:** conteúdo raster editável diretamente. Os tipos internos
  históricos `image` e `pixel` pertencem à mesma categoria visível.
- **Objeto inteligente:** invólucro não destrutivo cujo conteúdo pode ser aberto e
  editado separadamente.
- **Forma vetorial:** camada vetorial própria; não é subtipo de Objeto Inteligente.
- **Texto:** camada editável própria.
- **Plano de fundo:** estado especial do fundo do documento.
- **Ajuste:** reservado para os ajustes não destrutivos previstos no editor.

Os identificadores antigos não foram removidos do arquivo `.axia`, pois isso quebraria
projetos existentes e não oferece benefício ao usuário. A simplificação ocorre na
apresentação e nas ações disponíveis.

## 2026-09-14 — Implementação

- Criado um contrato único para nomes e explicações dos tipos de camada.
- `image` e `pixel` agora aparecem como **Camada de pixels** no painel.
- **Objeto inteligente** e **Forma vetorial** receberam nomenclatura inequívoca.
- O painel Propriedades passou a exibir o tipo da camada selecionada.
- O indicador sobre a miniatura do Objeto Inteligente ficou maior e mais contrastante.
- Menus passaram a usar **Converter em Objeto Inteligente**.
- **Rasterizar camada** deixou de aparecer para `image` e `pixel`, pois ambos já são
  conteúdo raster. A ação permanece para forma, texto, Objeto Inteligente e fundo
  quando houver conversão válida.

## Correção de “Editar conteúdo”

- A workspace de edição interna possuía apenas a linha de grid definida. Sem colunas
  explícitas, o navegador podia trocar o canvas e os painéis laterais de posição.
- Toolbar, canvas e painéis agora ocupam explicitamente as colunas 1, 2 e 3.
- O conteúdo do Objeto Inteligente continua abrindo como documento isolado, com ações
  **Cancelar** e **Concluir**, sem rasterizar suas camadas internas.

## Validação automatizada

- 384 testes frontend aprovados.
- TypeScript e build Vite de produção aprovados.
- Testes novos confirmam que `image` e `pixel` têm a mesma categoria visível e que
  Forma vetorial permanece distinta de Objeto Inteligente.

## Validação manual pendente

- Conferir os rótulos de pixels, forma, texto, fundo e Objeto Inteligente no painel.
- Converter uma forma em Objeto Inteligente e abrir **Editar conteúdo…**.
- Verificar que o canvas permanece na região central e os painéis na lateral direita.
- Alterar o conteúdo, concluir e confirmar a atualização do objeto no documento pai.
- Abrir novamente, cancelar e confirmar que nenhuma mudança interna foi publicada.
