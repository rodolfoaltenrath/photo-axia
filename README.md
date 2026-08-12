# Axia

Editor de imagens desktop construído com Go, Wails, Vue 3, TypeScript e Vite. O Axia reúne edição raster por camadas, ferramentas aceleradas por workers, projetos nativos e uma interface voltada para fluxos rápidos no Windows e Linux.

## Instalar no Linux com Flatpak

Baixe o arquivo `Axia.flatpak` da versão desejada e, na pasta onde ele foi
salvo, execute:

```sh
flatpak install --user ./Axia.flatpak
```

Abra pelo menu de aplicativos ou pelo terminal:

```sh
flatpak run io.github.rodolfoaltenrath.photo-axia
```

Para instalar manualmente uma versão mais recente por cima da atual:

```sh
flatpak install --user --reinstall ./Axia.flatpak
```

As atualizações não são recebidas apenas porque o código foi atualizado no
GitHub. Enquanto o Axia for distribuído como um arquivo avulso, cada nova
versão precisa ser baixada e reinstalada com o comando acima. Atualizações pelo
comando `flatpak update` estarão disponíveis quando o Axia possuir um
repositório Flatpak publicado.

![Tela inicial do Axia com projetos recentes](assets/background%201.jpeg)

![Editor do Axia com documento, camadas, propriedades, réguas e guias](assets/background%202.jpeg)

## Recursos atuais

### Projetos e documentos

- Tela inicial com projetos recentes, miniaturas, dimensões, data de modificação e indicação de arquivos ausentes.
- Criação de documentos em pixels, centímetros, milímetros ou polegadas.
- Predefinições para tela, fotografia e impressão, além de presets personalizados salvos localmente.
- Configuração de largura, altura, resolução, orientação e fundo transparente, branco ou preto.
- Proteção de alterações pendentes com as opções Salvar, Descartar e Cancelar.
- Formato nativo `.axia`, que preserva documento, camadas, assets, guias e estado de visualização.
- Salvamento normal e Salvar como, com atualização automática do histórico de projetos.
- Exportação da composição em PNG.

Consulte [docs/axia-format.md](docs/axia-format.md) para detalhes do formato de projeto.

### Importação e camadas

- Importação de PNG, JPEG e GIF pelo seletor de arquivos ou por arrastar e soltar.
- Miniaturas otimizadas e cache de previews para imagens grandes.
- Criação, seleção automática, movimentação, renomeação, duplicação, exclusão e reordenação de camadas.
- Controle individual de visibilidade e opacidade.
- Transformação livre com movimento, escala proporcional ou livre, escala pelo centro e rotação.
- Duplicação da camada completa ou somente da região selecionada com `Ctrl+J`.
- Exclusão contextual: apaga pixels quando existe uma seleção e remove a camada quando não existe.

### Seleção e manipulação de pixels

- Seleção retangular, elíptica, por laço livre e por varinha mágica.
- Varinha mágica com tolerância configurável e modos contíguo ou global.
- Quadrados e círculos perfeitos mantendo `Shift` durante o arraste.
- Selecionar tudo, desmarcar e deslocar a seleção com o teclado.
- Recorte e movimentação destrutiva dos pixels selecionados, preservando transparência na origem.
- Expansão automática do raster quando pixels movimentados ultrapassam os limites atuais da camada.
- Exclusão dos pixels selecionados com histórico atômico para desfazer e refazer.

### Pincel e borracha

- Pincel redondo sólido com tamanho e cor configuráveis.
- Borracha com tamanho configurável e o mesmo mecanismo otimizado de traçado do pincel.
- Pintura e apagamento diretamente na camada ativa, sem criar uma camada automaticamente.
- Respeito integral à região selecionada; sem seleção, o traço fica livre dentro do documento.
- Processamento incremental em worker e uma única entrada de histórico por traço completo.

### Texto

- Criação e edição de camadas de texto.
- Fontes Arial, Verdana, Georgia e Courier New.
- Configuração de conteúdo, tamanho, peso, cor, entrelinha e alinhamento.
- Redimensionamento, movimentação e rotação pelo mesmo sistema de transformação das outras camadas.

### Réguas, guias e navegação

- Réguas em pixels, centímetros, milímetros e polegadas, sincronizadas com zoom e pan.
- Guias horizontais e verticais criadas diretamente por arraste das réguas.
- Origem configurável, encaixe em guias, bloqueio, visibilidade e limpeza de todas as guias.
- Encaixe em bordas, centro da camada e limites da seleção.
- Zoom de 5% a 3200%, ancorado no cursor.
- Ajuste à tela, visualização em 100% e 200% e navegação pela ferramenta Mão, Espaço ou botão do meio.
- Documento centralizado horizontal e verticalmente ao abrir ou redimensionar o viewport.

### Histórico e desempenho

- Desfazer e refazer com deltas compactos, sem copiar o documento inteiro a cada ação.
- Agrupamento de operações contínuas, como pinceladas, transformações e movimento de guias.
- Linha do tempo navegável e orçamento de memória configurado para documentos extensos.
- Workers dedicados para pincel, borracha, varinha mágica, extração, exclusão e movimentação de seleções.
- Previews dimensionados pela área realmente visível, com limites de memória e reaproveitamento de raster.
- Miniaturas de projetos recentes armazenadas em cache externo, sem aumentar o arquivo `.axia`.

## Atalhos principais

### Arquivos e histórico

- `Ctrl+N`: novo documento.
- `Ctrl+O`: abrir projeto `.axia`.
- `Ctrl+S`: salvar projeto.
- `Ctrl+Shift+S`: salvar como.
- `Ctrl+Z`: desfazer.
- `Ctrl+Shift+Z` ou `Ctrl+Y`: refazer.
- `Esc` na tela inicial: retornar ao editor aberto.

### Ferramentas

- `V`: Mover.
- `B`: Pincel.
- `E`: Borracha.
- `C`: Recorte e seleção.
- `T`: Texto.
- `H`: Mão.
- `Z`: Zoom.

### Seleção e camadas

- `Ctrl+A`: selecionar todo o documento.
- `Ctrl+D` ou `Esc`: desmarcar.
- Setas: mover a região selecionada em 1 pixel.
- `Shift` + setas: mover a região selecionada em 10 pixels.
- `Delete` ou `Backspace`: apagar a seleção ou excluir a camada ativa quando não há seleção.
- `Ctrl+J`: copiar a região selecionada para uma nova camada; sem seleção, duplicar a camada ativa.
- `F2`: renomear a camada ativa no painel de camadas.
- `Alt+↑` / `Alt+↓`: elevar ou abaixar a camada ativa.

### Transformação livre

- `Ctrl+T`: transformar a camada ativa.
- Arrastar dentro da caixa: mover.
- Arrastar um canto: redimensionar proporcionalmente.
- `Shift` ao redimensionar: alternar para escala livre.
- `Alt` ao redimensionar: usar o centro como origem.
- Arrastar o controle circular: rotacionar.
- `Shift` ao rotacionar: encaixar em passos de 15 graus.
- `Enter` ou duplo clique: aplicar.
- `Esc`: cancelar e restaurar a transformação anterior.

### Zoom e navegação

- `Espaço` + arrastar ou botão do meio + arrastar: navegar pelo documento.
- `Ctrl+Espaço` + clique: zoom temporário para aproximar.
- `Alt+Espaço` + clique: zoom temporário para afastar.
- `Ctrl` + roda do mouse ou `Alt` + roda: zoom suave sob o cursor.
- `Z` + clique: aproximar; `Alt` + clique: afastar.
- `Ctrl++` / `Ctrl+-`: próximo nível de zoom.
- `Ctrl+0`: ajustar à tela.
- `Ctrl+1`: visualizar em 100%.
- `Ctrl+2`: visualizar em 200%.
- Duplo clique na Mão: ajustar à tela.
- Duplo clique no Zoom: retornar a 100%.
- Roda do mouse: navegar verticalmente.
- `Shift` + roda: navegar horizontalmente.

### Réguas e guias

- `Ctrl+R`: mostrar ou ocultar as réguas.
- `Ctrl+;`: mostrar ou ocultar as guias.
- Arrastar da régua horizontal ou vertical: criar uma guia.
- Arrastar uma guia para fora do documento: removê-la.

No macOS, use `Command` no lugar de `Ctrl` nos atalhos correspondentes.

## Executar no Windows

Requisitos para um ambiente novo:

- Go 1.23 ou superior.
- Node.js 24 ou superior.
- Wails 2.12.
- Microsoft Edge WebView2 Runtime.

Instale as dependências e execute em desenvolvimento:

```powershell
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
Set-Location frontend
npm install
Set-Location ..
wails dev
```

Gerar e executar a build de produção:

```powershell
wails build
Get-Process axia -ErrorAction SilentlyContinue | Stop-Process
.\build\bin\axia.exe
```

Se o checkout já possuir as toolchains locais usadas neste ambiente:

```powershell
$env:Path = "$PWD\.toolchains\go1.23.12\bin;$PWD\.toolchains\bin;C:\Program Files\nodejs;$env:Path"
.\.toolchains\bin\wails.exe build
.\build\bin\axia.exe
```

## Executar no Fedora

O instalador configura as bibliotecas nativas, Go 1.23.12, Wails 2.12 e Node.js 24 localmente para o projeto:

```sh
./scripts/setup-fedora.sh
source ./scripts/env.sh
./scripts/wails-dev.sh
```

Gerar a build:

```sh
./scripts/wails-build.sh
```

### Executar como Flatpak

O empacotamento usa o runtime GNOME 50, que fornece GTK 3 e WebKitGTK 4.1,
e compila o backend Go dentro do SDK. Na primeira execução, o comando baixa o
runtime e as ferramentas necessárias:

```sh
./scripts/flatpak-build.sh
```

Ao terminar, o Axia estará instalado para o usuário atual e também será gerado
em `dist/flatpak/Axia.flatpak`:

```sh
flatpak run io.github.rodolfoaltenrath.photo-axia
```

Para remover a instalação de teste:

```sh
flatpak uninstall --user io.github.rodolfoaltenrath.photo-axia
```

O App ID definitivo é `io.github.rodolfoaltenrath.photo-axia`. O manifesto fica
na raiz do projeto e os arquivos de integração ficam em `packaging/flatpak`.

O `sudo` é usado somente pelo `dnf`. As toolchains ficam em `.toolchains`, sem alterar instalações globais. Em outras distribuições, instale GTK 3, WebKit2GTK 4.1, um compilador C/C++ e `pkg-config` antes de executar os scripts de configuração.

## Testes

Backend Go:

```powershell
go test ./...
go vet ./...
```

Frontend:

```powershell
Set-Location frontend
npm test
npm run build
```

## Estrutura principal

- `app.go`: API nativa, importação, previews e integração com o sistema operacional.
- `project.go`: leitura e escrita segura do formato `.axia`.
- `recent_projects.go`: persistência, cache e concorrência dos projetos recentes.
- `main.go`: configuração da janela e inicialização do Wails.
- `frontend/src/components`: interface Vue do editor.
- `frontend/src/editor`: regras puras de edição, histórico, seleção, guias e viewport.
- `frontend/src/services`: integração com workers, imagens, projetos e backend.
- `frontend/src/workers`: processamento raster fora da thread principal.
- `frontend/tests`: testes automatizados do motor frontend.
- `frontend/wailsjs`: bindings TypeScript gerados pelo Wails.

## Tecnologias

- Go 1.23
- Wails 2.12
- Vue 3.5
- TypeScript 5.9
- Vite 8

## Estado do projeto

O Axia está em desenvolvimento ativo. O formato `.axia` está versionado, mas projetos importantes devem continuar sendo mantidos com backup enquanto o editor evolui.
