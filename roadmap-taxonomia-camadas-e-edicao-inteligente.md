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

O identificador histórico `image` continua aceito somente na fronteira de leitura do
arquivo `.axia`. Ao abrir um projeto antigo ele é migrado para `pixel` em memória e o
próximo salvamento grava o tipo canônico. Assim a compatibilidade é preservada sem
manter duas representações raster no motor ativo.

## 2026-09-15 — Canonicalização interna concluída

Estado: `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO MANUAL`

- `LayerItem` aceita somente os tipos canônicos no estado ativo.
- Imagens abertas como documento são camadas `pixel`, sem reamostragem.
- Imagens e páginas de PDF adicionadas a um documento são Objetos Inteligentes;
  seu conteúdo interno será uma camada `pixel` nas dimensões nativas.
- O cache visual externo e o conteúdo interno compartilham a mesma URL de asset.
  O manifesto já deduplica fontes, portanto isso não duplica os bytes salvos.
- Mesclagem, cópia de seleção e rasterização produzem sempre `pixel`.
- A leitura continua validando `image` legado e o converte recursivamente,
  inclusive dentro de Objetos Inteligentes antigos.

### Implementação concluída

- `image` foi removido de `LayerKind`; nenhuma operação ativa do editor pode criar
  esse tipo por acidente.
- Abrir imagem ou PDF como documento cria uma camada `pixel` nas dimensões nativas.
- Importar imagem ou página de PDF em um documento cria um Objeto Inteligente com
  uma camada `pixel` interna e transformação externa não destrutiva.
- O invólucro e o conteúdo reutilizam a fonte importada. O cache externo continua
  derivado e é descartado no histórico e no manifesto, evitando persistência dupla.
- Duplicar fundo, copiar seleção e mesclar camadas agora produzem `pixel`.
- O restaurador aceita `image` apenas no manifesto legado e o converte para `pixel`
  recursivamente. Salvar novamente elimina o identificador antigo.
- Fixtures de histórico, renderização, guias, estilos e Objetos Inteligentes foram
  atualizadas para trabalhar com o contrato canônico.

### Validação automatizada

- 386 testes frontend aprovados.
- `vue-tsc` e build Vite de produção aprovados.
- Testes Go aprovados.
- Testes novos cobrem criação raster nativa, colocação inteligente, asset
  compartilhado e migração recursiva de projetos antigos.
- `git diff --check` sem erros; somente avisos esperados de normalização LF/CRLF.

## 2026-09-15 — Clareza para usuários não técnicos

Estado: `CONCLUÍDO — REVISÃO DE UI APLICADA`

- A lista de camadas usa a terminologia conhecida por usuários de editores:
  **Camada rasterizada**, **Forma**, **Texto** e **Objeto inteligente**.
- Texto, forma e Objeto Inteligente continuarão identificáveis pela miniatura e por
  seus indicadores visuais, sem adicionar mais controles permanentes ao painel.
- A ação permanece nomeada **Rasterizar camada** e é executada diretamente, sem
  uma confirmação intermediária.
- Pincel, Borracha, Degradê e Balde deixam de falhar silenciosamente sobre
  conteúdo não raster: a barra contextual explica a limitação e oferece
  **Editar conteúdo** ou **Rasterizar camada**, conforme a camada.
- Ações exclusivas de Objetos Inteligentes permanecerão ocultas nos demais tipos.

### Implementado

- A lista e o painel Propriedades usam **Camada rasterizada**, **Texto**, **Forma** e
  **Objeto inteligente**, com explicações completas nas dicas.
- O indicador de conteúdo original permanece sobre a miniatura e agora possui descrição
  acessível e instrução de duplo clique.
- Menus e ações contextuais usam **Converter em Objeto Inteligente**,
  **Editar conteúdo…** e **Rasterizar camada**.
- A rasterização é direta e continua integralmente reversível pelo histórico/`Ctrl+Z`.
- Pincel, Borracha, Degradê e Balde exibem uma orientação contextual quando a camada
  selecionada não aceita edição direta, incluindo os atalhos para editar o original ou
  rasterizar a camada quando aplicável.
- A janela de edição interna identifica a sessão como **Objeto inteligente**, mantendo
  a mesma terminologia em todo o fluxo.

### Validação desta etapa

- 386 testes frontend aprovados.
- Verificação TypeScript e build Vite de produção aprovados.
- Testes Go aprovados.
- `git diff --check` sem erros; somente avisos esperados de normalização LF/CRLF.
- Após a revisão de UI, a versão de distribuição foi atualizada para `0.1.3`
  e o instalador Windows NSIS correspondente foi gerado.

## 2026-09-14 — Implementação

- Criado um contrato único para nomes e explicações dos tipos de camada.
- O legado `image` e o tipo `pixel` agora aparecem como **Camada rasterizada** no painel.
- **Objeto inteligente** e **Forma** receberam nomenclatura inequívoca.
- O painel Propriedades passou a exibir o tipo da camada selecionada.
- O indicador sobre a miniatura do Objeto Inteligente ficou maior e mais contrastante.
- Menus usam **Converter em Objeto Inteligente** e **Rasterizar camada**.
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

- Abrir uma imagem e um PDF como documento e confirmar **Camada rasterizada**.
- Importar uma imagem e uma página de PDF em documento existente e confirmar
  **Objeto inteligente**, caixa de transformação e **Editar conteúdo…**.
- Rasterizar um Objeto Inteligente e confirmar que passa a **Camada rasterizada**.
- Abrir um `.axia` criado antes desta migração, salvar uma cópia e reabri-la.
- Conferir os rótulos de pixels, forma, texto, fundo e Objeto Inteligente no painel.
- Converter uma forma em Objeto Inteligente e abrir **Editar conteúdo…**.
- Verificar que o canvas permanece na região central e os painéis na lateral direita.
- Alterar o conteúdo, concluir e confirmar a atualização do objeto no documento pai.
- Abrir novamente, cancelar e confirmar que nenhuma mudança interna foi publicada.
