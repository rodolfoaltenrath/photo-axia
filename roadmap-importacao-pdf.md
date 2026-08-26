# Roadmap — Importação raster de PDF

## Objetivo

Permitir que o usuário escolha um PDF, visualize suas páginas e importe uma
delas como camada raster editável no documento atual, sem dependências
nativas adicionais no Windows ou Linux.

## Decisões de arquitetura

- O Wails/Go seleciona e valida o arquivo, mas não rasteriza o PDF.
- O arquivo fica disponível somente por uma URL interna temporária com token.
- O PDF.js interpreta o documento em seu worker e renderiza as páginas em Canvas.
- O Vue controla senha, miniaturas, seleção, DPI, fundo, progresso e cancelamento.
- A página escolhida vira um PNG e entra no pipeline existente de assets, previews,
  camadas, histórico e projeto `.axia`.
- O PDF.js é carregado sob demanda para não aumentar o custo de inicialização do editor.
- Textos e vetores são rasterizados; importação semântica/editável não faz parte deste escopo.

## Etapas implementadas

### 1. Backend seguro

- [x] Seletor nativo com filtro `*.pdf`.
- [x] Limite de 512 MB e validação da assinatura `%PDF-`.
- [x] Registro por token aleatório, sem expor caminhos ao frontend.
- [x] Rota `__axia_pdf` com suporte a leitura parcial, `no-store` e `nosniff`.
- [x] Liberação explícita ao concluir/cancelar e limpeza no shutdown.
- [x] Testes para registro, leitura, liberação e conteúdo inválido.

### 2. Motor de rasterização

- [x] Dependência oficial `pdfjs-dist` fixada no lockfile.
- [x] Worker empacotado pelo Vite.
- [x] Carregamento dinâmico do motor somente ao importar PDF.
- [x] Leitura de páginas, rotação e dimensões em pontos.
- [x] Rasterização sequencial para limitar picos de memória.
- [x] PNG com fundo branco ou transparente.
- [x] Cancelamento da renderização em andamento.
- [x] Cancelamento também durante abertura, senha e leitura inicial das páginas.
- [x] Liberação de páginas, canvases, worker e URLs temporárias.

### 3. Interface Vue

- [x] Comando `Arquivo > Importar PDF…`.
- [x] Arrastar e soltar um PDF abre a mesma escolha de página no desktop e no modo web.
- [x] Suporte equivalente pelo seletor HTML no modo web.
- [x] Modal com miniaturas e seleção de uma página por importação.
- [x] Miniaturas carregadas sob demanda conforme entram na área visível, com concorrência limitada.
- [x] Presets 96, 150 e 300 DPI e valor personalizado de 36 a 600 DPI.
- [x] Senha para PDFs protegidos.
- [x] Dimensão final e estimativa de memória em linguagem simples.
- [x] Aviso de que texto e vetores deixam de ser editáveis.
- [x] Progresso e cancelamento durante a conversão.

### 4. Integração com o editor

- [x] Página importada como camada de imagem.
- [x] Nomes no formato `arquivo — página N`.
- [x] DPI preservado nos metadados do asset e do projeto `.axia`.
- [x] Ajuste visual ao documento atual sem descartar o raster original.
- [x] Previews otimizados e seleção automática da ferramenta Mover.
- [x] Uma entrada no histórico para a página importada.
- [x] Rollback completo de camadas, previews e URLs quando a inclusão falha.
- [x] Limites de 16.384 px, 64 MP e 48 MiB de raster aplicados à página escolhida.
- [x] Fechamento da janela com página importada respeita a confirmação nativa de alterações não salvas.

## Validação automatizada

- [x] Cálculo A4 em 150 DPI: aproximadamente 1240 × 1754 px.
- [x] Cálculo A4 em 300 DPI: aproximadamente 2480 × 3508 px.
- [x] Normalização de páginas e DPI.
- [x] Rejeição de dimensões acima dos limites do editor.
- [x] Estimativa de memória RGBA.
- [x] Testes Go e frontend.
- [x] TypeScript estrito e build Vite.
- [x] Validação prática contínua com PDFs reais no Windows pelo mantenedor.
- [x] Execução e teste da aplicação empacotada como Flatpak no Linux.

## Estratégia de validação prática

O mantenedor usa o editor diariamente e valida a importação com documentos reais
durante esse uso. Achados práticos devem virar casos de regressão automatizados quando
reproduzíveis; não há um roteiro manual separado a manter.

## Possíveis evoluções posteriores

- Abrir cada página como documento separado quando o editor suportar múltiplos documentos.
- Manter o PDF como camada inteligente para trocar DPI sem perda acumulada.
- Importação vetorial/semântica de texto e formas, tratada como projeto independente.
