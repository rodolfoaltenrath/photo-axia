# Axia

[English](#english) · [简体中文](#simplified-chinese) · [Português (Brasil)](#português-brasil)

![Axia home screen with recent projects](assets/background%201.jpeg)

![Axia editor with document, layers, properties, rulers, and guides](assets/background%202.jpg)

---

<a id="english"></a>

## English

Axia is a desktop image editor built with Go, Wails, Vue 3, TypeScript, and
Vite. It combines layer-based raster editing, worker-accelerated tools, native
project files, and a workflow-focused interface for Windows and Linux.

### Install on Linux with Flatpak

Download `Axia.flatpak` from the desired release and run this command from its
download directory:

```sh
flatpak install --user ./Axia.flatpak
```

Open Axia from the application menu or a terminal:

```sh
flatpak run io.github.rodolfoaltenrath.photo-axia
```

To manually install a newer build over the current one:

```sh
flatpak install --user --reinstall ./Axia.flatpak
```

Publication in a Flatpak repository is still in progress, so automatic updates
through `flatpak update` are not available yet.

### Current features

#### Projects and documents

- Home screen with recent-project thumbnails, dimensions, modification dates,
  and missing-file indicators.
- Documents in pixels, centimeters, millimeters, or inches.
- Screen, photography, and print presets, plus locally saved custom presets.
- Configurable width, height, resolution, orientation, and transparent, white,
  or black background.
- Unsaved-change protection with Save, Discard, and Cancel.
- Versioned `.axia` format preserving the document, layers, assets, guides, and
  view state.
- Save and Save As with automatic recent-project history updates.
- Composited-image export to PNG.

See [docs/axia-format.md](docs/axia-format.md) for the project format.

#### Import and layers

- PNG, JPEG, and GIF import through the file picker or drag and drop.
- Raster import of one PDF page at a time, with thumbnails, password,
  resolution, and background controls.
- Optimized thumbnails and preview caching for large images.
- Layer creation, auto-selection, movement, renaming, duplication, deletion,
  and reordering.
- Per-layer visibility and opacity.
- Normal, Multiply, Divide, Overlay, Darken, and Lighten blend modes.
- Free transform with movement, proportional or free scaling, center-based
  scaling, and rotation.
- `Ctrl+J` duplicates the full layer or only the selected region.
- Context-aware deletion removes selected pixels or, without a selection, the
  active layer.

#### Selection and pixel manipulation

- Rectangular, elliptical, freehand lasso, and magic-wand selections.
- Magic Wand with configurable tolerance and contiguous or global modes.
- Hold `Shift` while dragging to create perfect squares and circles.
- Select all, deselect, and move a selection with the keyboard.
- Destructive cutting and movement of selected pixels, leaving transparency at
  the source.
- Automatic raster expansion when moved pixels exceed current layer bounds.
- Atomic undo/redo history when deleting selected pixels.

#### Brush and eraser

- Solid round brush with configurable size and color.
- Configurable eraser using the brush's optimized stroke engine.
- Painting and erasing directly on the active layer without creating a layer.
- Full selection masking; without a selection, strokes are free within the document.
- Incremental worker processing and one history entry per complete stroke.

#### Colors and eyedropper

- Editable primary and secondary colors, quick swap, and black/white reset.
- Continuous eyedropper over the visible document composition.
- Left click samples the primary color; right click samples the secondary color.
- Sampling synchronized with pending raster commits and limited to the latest pixel.
- Decoded-image caching and spatial layer filtering during sampling.

#### Gradients and fills

- Linear and radial gradients with up to 32 color stops and 32 opacity stops.
- Unified checkerboard editor: each stop exposes color, visibility, and position,
  while the engine keeps color and opacity interpolation independent.
- Click the strip to add a color; `Alt+drag` duplicates a stop. “No color
  (transparent)” produces zero alpha without exposing technical details.
- Interactive preview constrained by rectangular, elliptical, lasso, or
  magic-wand selections.
- Paint Bucket with tolerance and contiguous/global modes, also constrained by
  the active selection.

#### Text

- Create and edit text layers.
- Arial, Verdana, Georgia, and Courier New fonts.
- Content, size, weight, color, line-height, and alignment controls.
- Resize, move, and rotate through the shared transform system.

#### Rulers, guides, and navigation

- Pixel, centimeter, millimeter, and inch rulers synchronized with zoom and pan.
- Horizontal and vertical guides dragged directly from rulers.
- Configurable origin, guide snapping, locking, visibility, and clear-all.
- Snapping to edges, layer center, and selection bounds.
- Cursor-anchored zoom from 5% to 3200%.
- Fit to screen, 100%, 200%, and navigation with the Hand tool, Space, or the
  middle mouse button.
- Automatic horizontal and vertical document centering when opening or resizing.

#### History and performance

- Undo/redo with compact deltas instead of full-document copies.
- Continuous-operation grouping for strokes, transforms, and guide movement.
- Navigable history timeline and a memory budget for large documents.
- Dedicated workers for brush, eraser, Magic Wand, extraction, deletion, and
  selection movement.
- Previews sized to the visible area, with memory limits and raster reuse.
- Recent-project thumbnails in an external cache, keeping `.axia` files small.

### Main shortcuts

#### Files and history

- `Ctrl+N`: new document; `Ctrl+O`: open an `.axia` project.
- `Ctrl+S`: save; `Ctrl+Shift+S`: Save As.
- `Ctrl+Z`: undo; `Ctrl+Shift+Z` or `Ctrl+Y`: redo.
- `Esc` on the home screen: return to the open editor.

#### Tools

- `V`: Move; `B`: Brush; `E`: Eraser; `I`: Eyedropper.
- `G`: Gradient; `Shift+G`: Paint Bucket.
- `C`: Crop and selection; `T`: Text; `H`: Hand; `Z`: Zoom.

#### Selection and layers

- `Ctrl+A`: select all; `Ctrl+D` or `Esc`: deselect.
- Arrow keys: move the selected region by 1 pixel; add `Shift` for 10 pixels.
- `Delete` or `Backspace`: delete the selection, or the active layer when there
  is no selection.
- `Ctrl+J`: copy the selection to a new layer, or duplicate the active layer.
- `F2`: rename the active layer.
- `Alt+↑` / `Alt+↓`: raise or lower the active layer.

#### Free transform

- `Ctrl+T`: transform the active layer.
- Drag inside the box to move; drag a corner to scale proportionally.
- Hold `Shift` for free scaling or `Alt` to scale from the center.
- Drag the circular control to rotate; hold `Shift` to snap to 15° increments.
- `Enter` or double-click applies; `Esc` cancels and restores the prior transform.

#### Zoom and navigation

- `Space+drag` or middle-button drag: pan.
- `Ctrl+Space+click`: temporary zoom in; `Alt+Space+click`: zoom out.
- `Ctrl+wheel` or `Alt+wheel`: smooth cursor-centered zoom.
- With the Zoom tool, click to zoom in and `Alt+click` to zoom out.
- `Ctrl++` / `Ctrl+-`: next zoom level; `Ctrl+0`: fit to screen;
  `Ctrl+1`: 100%; `Ctrl+2`: 200%.
- Double-click Hand to fit; double-click Zoom to return to 100%.
- Mouse wheel pans vertically; `Shift+wheel` pans horizontally.

#### Rulers and guides

- `Ctrl+R`: show/hide rulers; `Ctrl+;`: show/hide guides.
- Drag from a ruler to create a guide; drag it outside the document to remove it.

On macOS, use `Command` instead of `Ctrl` for the corresponding shortcuts.

### Run on Windows

Requirements: Go 1.26.5, Node.js 24+, Wails 3.0.0-beta.12, and Microsoft Edge
WebView2 Runtime.

```powershell
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.12
Set-Location frontend
npm install
Set-Location ..
wails3 dev -config ./build/config.yml
```

Production build:

```powershell
wails3 build
.\bin\axia.exe
```

If the checkout contains the local toolchains used by this project:

```powershell
$env:Path = "$PWD\.toolchains\go1.23.12\bin;$PWD\.toolchains\bin;$PWD\.toolchains\node-v24.14.1-win-x64;$env:Path"
$env:GOTOOLCHAIN = "go1.26.5"
.\.toolchains\bin\wails3.exe build
.\bin\axia.exe
```

### Run on Fedora

The setup script installs native GTK4/WebKitGTK 6.0 libraries and local project
toolchains for Go 1.26.5, Wails 3.0.0-beta.12, and Node.js 24:

```sh
./scripts/setup-fedora.sh
source ./scripts/env.sh
./scripts/wails-dev.sh
```

Build with `./scripts/wails-build.sh`.

#### Run as Flatpak

Packaging uses GNOME 50, which provides GTK 3 and WebKitGTK 4.1, and compiles
the Go backend inside the SDK. The first run downloads the required runtime and tools:

```sh
./scripts/flatpak-build.sh
flatpak run io.github.rodolfoaltenrath.photo-axia
```

The bundle is written to `dist/flatpak/Axia.flatpak` and installed for the
current user. Remove the test installation with:

```sh
flatpak uninstall --user io.github.rodolfoaltenrath.photo-axia
```

The App ID is `io.github.rodolfoaltenrath.photo-axia`. Its manifest is in the
repository root and integration files are under `packaging/flatpak`. `sudo` is
used only by `dnf`; toolchains remain in `.toolchains`. On other distributions,
install GTK 3, WebKit2GTK 4.1, a C/C++ compiler, and `pkg-config` first.

### Tests

```powershell
go test ./...
go vet ./...
Set-Location frontend
npm test
npm run build
```

### Project structure

- `app.go`: native API, imports, previews, and operating-system integration.
- `project.go`: safe `.axia` reading and writing.
- `recent_projects.go`: recent-project persistence, cache, and concurrency.
- `main.go`: window configuration and Wails startup.
- `frontend/src/components`: Vue editor interface.
- `frontend/src/editor`: pure editing, history, selection, guide, and viewport rules.
- `frontend/src/services`: workers, images, projects, and backend integration.
- `frontend/src/workers`: raster processing outside the main thread.
- `frontend/tests`: automated frontend-engine tests.
- `frontend/bindings`: typed TypeScript bindings generated by Wails v3.
- `Taskfile.yml`: development, bindings, test, and build tasks.
- `build/config.yml`: Wails v3 metadata and development lifecycle.

### Technology and project status

Go 1.26.5 · Wails 3.0.0-beta.12 · Vue 3.5 · TypeScript 5.9 · Vite 8

Axia is under active development. The `.axia` format is versioned, but important
projects should remain backed up while the editor evolves.

[Back to language selection](#axia)

---

<a id="simplified-chinese"></a>

## 简体中文

Axia 是一款使用 Go、Wails、Vue 3、TypeScript 和 Vite 构建的桌面图像编辑器。它面向 Windows 和 Linux，提供基于图层的光栅编辑、由 Worker 加速的工具、原生项目文件，以及专注高效工作流的界面。

### 在 Linux 上通过 Flatpak 安装

从所需版本下载 `Axia.flatpak`，然后在下载目录中执行：

```sh
flatpak install --user ./Axia.flatpak
flatpak run io.github.rodolfoaltenrath.photo-axia
```

手动覆盖安装较新版本：

```sh
flatpak install --user --reinstall ./Axia.flatpak
```

Flatpak 软件源仍在准备中，因此目前尚不支持通过 `flatpak update` 自动更新。

### 当前功能

#### 项目与文档

- 首页显示最近项目、缩略图、尺寸、修改日期以及文件丢失提示。
- 可使用像素、厘米、毫米或英寸创建文档。
- 提供屏幕、摄影和打印预设，并支持保存在本地的自定义预设。
- 可配置宽度、高度、分辨率、方向以及透明、白色或黑色背景。
- 未保存更改提供“保存”“放弃”和“取消”保护。
- 带版本的 `.axia` 原生格式可保存文档、图层、资源、参考线和视图状态。
- 支持保存和另存为，并自动更新最近项目记录。
- 可将合成结果导出为 PNG。

项目格式详见 [docs/axia-format.md](docs/axia-format.md)。

#### 导入与图层

- 通过文件选择器或拖放导入 PNG、JPEG 和 GIF。
- 每次将一个 PDF 页面光栅化导入，并可配置缩略图、密码、分辨率和背景。
- 为大型图像提供优化缩略图和预览缓存。
- 支持创建、自动选择、移动、重命名、复制、删除和重新排序图层。
- 每个图层均可独立控制可见性和不透明度。
- 支持正常、正片叠底、划分、叠加、变暗和变亮混合模式。
- 自由变换支持移动、等比或自由缩放、中心缩放和旋转。
- `Ctrl+J` 可复制整个图层或仅复制选区。
- 上下文删除：有选区时删除像素，无选区时删除活动图层。

#### 选择与像素操作

- 支持矩形、椭圆、自由套索和魔棒选择。
- 魔棒提供可调容差以及连续/全局模式。
- 拖动时按住 `Shift` 可创建正方形或正圆。
- 支持全选、取消选择以及使用键盘移动选区。
- 可破坏性剪切并移动选中像素，在原位置保留透明区域。
- 当移动像素超出图层边界时自动扩展光栅。
- 删除选中像素会生成原子化的撤销/重做历史记录。

#### 画笔与橡皮擦

- 实心圆形画笔，可配置大小和颜色。
- 橡皮擦可配置大小，并复用画笔的优化笔画引擎。
- 直接在活动图层上绘制或擦除，不会自动创建新图层。
- 完整遵守活动选区；无选区时可在文档范围内自由绘制。
- 使用 Worker 增量处理，每个完整笔画只生成一条历史记录。

#### 颜色与吸管

- 可编辑前景色和背景色，支持快速互换及恢复黑白默认值。
- 可在文档可见合成结果上连续取色。
- 左键取前景色，右键取背景色。
- 取色会与待提交的光栅操作同步，并只处理最新像素。
- 取色时使用已解码图像缓存和图层空间过滤。

#### 渐变与填充

- 线性和径向渐变最多支持 32 个颜色节点和 32 个不透明度节点。
- 统一的棋盘格编辑器为每个节点提供颜色、可见性和位置，同时引擎内部保持颜色与不透明度独立插值。
- 单击色带可添加颜色；`Alt+拖动` 可复制节点；“无颜色（透明）”会生成零 Alpha。
- 交互式预览支持矩形、椭圆、套索和魔棒选区限制。
- 油漆桶支持容差、连续/全局模式，并受活动选区限制。

#### 文字

- 创建和编辑文字图层。
- 支持 Arial、Verdana、Georgia 和 Courier New。
- 可配置内容、字号、字重、颜色、行高和对齐方式。
- 使用统一变换系统缩放、移动和旋转。

#### 标尺、参考线与导航

- 像素、厘米、毫米和英寸标尺与缩放和平移同步。
- 可直接从标尺拖出水平或垂直参考线。
- 支持设置原点、吸附、锁定、显示/隐藏以及清除所有参考线。
- 可吸附到边缘、图层中心和选区边界。
- 以光标为中心进行 5% 至 3200% 缩放。
- 支持适合屏幕、100%、200%，并可通过抓手工具、空格键或鼠标中键导航。
- 打开文档或调整视口时自动水平、垂直居中。

#### 历史记录与性能

- 撤销/重做使用紧凑差量，不会每次复制整个文档。
- 笔画、变换和参考线移动等连续操作会合并记录。
- 提供可导航历史时间线，并为大型文档设置内存预算。
- 画笔、橡皮擦、魔棒、提取、删除和选区移动使用专用 Worker。
- 预览按实际可见区域调整大小，限制内存并复用光栅。
- 最近项目缩略图保存在外部缓存中，不增加 `.axia` 文件体积。

### 主要快捷键

#### 文件与历史

- `Ctrl+N`：新建；`Ctrl+O`：打开 `.axia`；`Ctrl+S`：保存；`Ctrl+Shift+S`：另存为。
- `Ctrl+Z`：撤销；`Ctrl+Shift+Z` 或 `Ctrl+Y`：重做。
- 首页按 `Esc`：返回已打开的编辑器。

#### 工具

- `V` 移动；`B` 画笔；`E` 橡皮擦；`I` 吸管。
- `G` 渐变；`Shift+G` 油漆桶；`C` 裁剪与选择。
- `T` 文字；`H` 抓手；`Z` 缩放。

#### 选择与图层

- `Ctrl+A` 全选；`Ctrl+D` 或 `Esc` 取消选择。
- 方向键移动选区 1 像素；加 `Shift` 移动 10 像素。
- `Delete` 或 `Backspace` 删除选区；无选区时删除活动图层。
- `Ctrl+J` 将选区复制到新图层；无选区时复制活动图层。
- `F2` 重命名活动图层；`Alt+↑` / `Alt+↓` 上移/下移图层。

#### 自由变换

- `Ctrl+T` 变换活动图层；拖动框内区域可移动，拖动角点可等比缩放。
- 缩放时按 `Shift` 切换自由缩放，按 `Alt` 从中心缩放。
- 拖动圆形控件旋转；按 `Shift` 以 15° 为步进吸附。
- `Enter` 或双击应用；`Esc` 取消并恢复先前状态。

#### 缩放与导航

- `空格+拖动` 或鼠标中键拖动：平移。
- `Ctrl+空格+单击` 临时放大；`Alt+空格+单击` 缩小。
- `Ctrl+滚轮` 或 `Alt+滚轮`：以光标为中心平滑缩放。
- 缩放工具下单击放大，`Alt+单击` 缩小。
- `Ctrl++` / `Ctrl+-` 切换缩放级别；`Ctrl+0` 适合屏幕；`Ctrl+1` 100%；`Ctrl+2` 200%。
- 双击抓手适合屏幕；双击缩放工具恢复 100%。
- 滚轮垂直导航；`Shift+滚轮` 水平导航。

#### 标尺与参考线

- `Ctrl+R` 显示/隐藏标尺；`Ctrl+;` 显示/隐藏参考线。
- 从标尺拖动可创建参考线；将其拖出文档即可删除。

在 macOS 上，相应快捷键请使用 `Command` 代替 `Ctrl`。

### 在 Windows 上运行

要求：Go 1.26.5、Node.js 24 或更高版本、Wails 3.0.0-beta.12，以及 Microsoft Edge WebView2 Runtime。

```powershell
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.12
Set-Location frontend
npm install
Set-Location ..
wails3 dev -config ./build/config.yml
```

生产构建：

```powershell
wails3 build
.\bin\axia.exe
```

如果检出目录已包含本项目使用的本地工具链：

```powershell
$env:Path = "$PWD\.toolchains\go1.23.12\bin;$PWD\.toolchains\bin;$PWD\.toolchains\node-v24.14.1-win-x64;$env:Path"
$env:GOTOOLCHAIN = "go1.26.5"
.\.toolchains\bin\wails3.exe build
.\bin\axia.exe
```

### 在 Fedora 上运行

安装脚本会配置原生 GTK4/WebKitGTK 6.0 库，以及项目本地的 Go 1.26.5、Wails 3.0.0-beta.12 和 Node.js 24：

```sh
./scripts/setup-fedora.sh
source ./scripts/env.sh
./scripts/wails-dev.sh
```

使用 `./scripts/wails-build.sh` 构建。

#### 作为 Flatpak 运行

打包使用提供 GTK 3 和 WebKitGTK 4.1 的 GNOME 50 runtime，并在 SDK 内编译 Go 后端。首次运行会下载所需 runtime 和工具：

```sh
./scripts/flatpak-build.sh
flatpak run io.github.rodolfoaltenrath.photo-axia
```

软件包会写入 `dist/flatpak/Axia.flatpak`，并为当前用户安装。删除测试安装：

```sh
flatpak uninstall --user io.github.rodolfoaltenrath.photo-axia
```

App ID 为 `io.github.rodolfoaltenrath.photo-axia`。清单位于仓库根目录，集成文件位于 `packaging/flatpak`。`sudo` 仅供 `dnf` 使用；工具链保存在 `.toolchains`。其他发行版需先安装 GTK 3、WebKit2GTK 4.1、C/C++ 编译器和 `pkg-config`。

### 测试

```powershell
go test ./...
go vet ./...
Set-Location frontend
npm test
npm run build
```

### 项目结构

- `app.go`：原生 API、导入、预览和操作系统集成。
- `project.go`：安全读写 `.axia`；`recent_projects.go`：最近项目、缓存和并发。
- `main.go`：窗口配置和 Wails 启动。
- `frontend/src/components`：Vue 编辑器界面。
- `frontend/src/editor`：纯编辑、历史、选择、参考线和视口规则。
- `frontend/src/services`：Worker、图像、项目和后端集成。
- `frontend/src/workers`：主线程之外的光栅处理；`frontend/tests`：自动化前端测试。
- `frontend/bindings`：Wails v3 生成的类型化 TypeScript bindings。
- `Taskfile.yml`：开发、bindings、测试和构建任务。
- `build/config.yml`：Wails v3 元数据和开发生命周期。

### 技术与项目状态

Go 1.26.5 · Wails 3.0.0-beta.12 · Vue 3.5 · TypeScript 5.9 · Vite 8

Axia 正在积极开发中。`.axia` 格式带有版本，但在编辑器持续演进期间，重要项目仍应保留备份。

[返回语言选择](#axia)

---

<a id="português-brasil"></a>

## Português (Brasil)

O Axia é um editor de imagens desktop construído com Go, Wails, Vue 3,
TypeScript e Vite. Ele reúne edição raster por camadas, ferramentas aceleradas
por workers, projetos nativos e uma interface voltada para fluxos rápidos no
Windows e Linux.

### Instalar no Linux com Flatpak

Baixe o `Axia.flatpak` da versão desejada e execute na pasta do download:

```sh
flatpak install --user ./Axia.flatpak
flatpak run io.github.rodolfoaltenrath.photo-axia
```

Para instalar manualmente uma versão mais recente sobre a atual:

```sh
flatpak install --user --reinstall ./Axia.flatpak
```

A publicação do repositório Flatpak ainda está em andamento; por isso,
atualizações automáticas com `flatpak update` ainda não estão disponíveis.

### Recursos atuais

#### Projetos e documentos

- Tela inicial com projetos recentes, miniaturas, dimensões, data de modificação
  e indicação de arquivos ausentes.
- Documentos em pixels, centímetros, milímetros ou polegadas.
- Presets de tela, fotografia e impressão, além de presets personalizados locais.
- Largura, altura, resolução, orientação e fundo transparente, branco ou preto.
- Proteção de alterações pendentes com Salvar, Descartar e Cancelar.
- Formato `.axia` versionado, preservando documento, camadas, assets, guias e visualização.
- Salvar e Salvar como com atualização automática do histórico de projetos.
- Exportação da composição em PNG.

Veja [docs/axia-format.md](docs/axia-format.md) para detalhes do formato.

#### Importação e camadas

- Importação de PNG, JPEG e GIF pelo seletor ou por arrastar e soltar.
- Importação raster de uma página PDF por vez, com miniaturas, senha, resolução e fundo.
- Miniaturas otimizadas e cache de previews para imagens grandes.
- Criação, seleção automática, movimentação, renomeação, duplicação, exclusão e reordenação de camadas.
- Visibilidade e opacidade individuais.
- Mesclagem Normal, Multiplicação, Divisão, Sobrepor, Escurecer e Clarear.
- Transformação livre com movimento, escala proporcional/livre, escala pelo centro e rotação.
- `Ctrl+J` duplica a camada completa ou somente a região selecionada.
- Exclusão contextual apaga pixels ou, sem seleção, remove a camada ativa.

#### Seleção e manipulação de pixels

- Seleção retangular, elíptica, por laço livre e por varinha mágica.
- Varinha com tolerância configurável e modos contíguo ou global.
- `Shift` durante o arraste cria quadrados e círculos perfeitos.
- Selecionar tudo, desmarcar e deslocar a seleção pelo teclado.
- Recorte e movimento destrutivo dos pixels, preservando transparência na origem.
- Expansão automática do raster quando os pixels ultrapassam os limites da camada.
- Exclusão de pixels com histórico atômico para desfazer e refazer.

#### Pincel e borracha

- Pincel redondo sólido com tamanho e cor configuráveis.
- Borracha configurável usando o mesmo mecanismo otimizado de traçado.
- Pintura e apagamento na camada ativa, sem criar camada automaticamente.
- Respeito integral à seleção; sem seleção, o traço fica livre no documento.
- Processamento incremental em worker e uma entrada de histórico por traço.

#### Cores e conta-gotas

- Cores principal e secundária editáveis, troca rápida e restauração preto/branco.
- Conta-gotas contínuo sobre a composição visível.
- Botão esquerdo coleta a cor principal; botão direito, a secundária.
- Amostragem sincronizada com commits pendentes e limitada ao pixel mais recente.
- Cache de imagens decodificadas e filtragem espacial das camadas.

#### Degradê e preenchimento

- Degradês lineares e radiais com até 32 pontos de cor e 32 de opacidade.
- Editor unificado sobre xadrez: cada ponto reúne cor, visibilidade e posição,
  mantendo interpolações independentes no motor.
- Clique na faixa adiciona cor; `Alt+arrastar` duplica um ponto; “Sem cor
  (transparente)” cria alfa zero.
- Preview interativo limitado por seleções retangulares, elípticas, laço ou varinha.
- Balde de tinta com tolerância, modos contíguo/global e limite pela seleção ativa.

#### Texto

- Criação e edição de camadas de texto.
- Fontes Arial, Verdana, Georgia e Courier New.
- Conteúdo, tamanho, peso, cor, entrelinha e alinhamento configuráveis.
- Redimensionamento, movimento e rotação pelo sistema compartilhado de transformação.

#### Réguas, guias e navegação

- Réguas em pixels, centímetros, milímetros e polegadas sincronizadas com zoom e pan.
- Guias horizontais e verticais arrastadas diretamente das réguas.
- Origem, encaixe, bloqueio, visibilidade e limpeza de todas as guias.
- Encaixe em bordas, centro da camada e limites da seleção.
- Zoom de 5% a 3200%, ancorado no cursor.
- Ajuste à tela, 100%, 200% e navegação pela Mão, Espaço ou botão do meio.
- Centralização horizontal e vertical ao abrir ou redimensionar o viewport.

#### Histórico e desempenho

- Desfazer/refazer com deltas compactos, sem copiar o documento inteiro.
- Agrupamento de pinceladas, transformações e movimento de guias.
- Timeline navegável e orçamento de memória para documentos extensos.
- Workers para pincel, borracha, varinha, extração, exclusão e movimento de seleções.
- Previews pela área visível, com limites de memória e reaproveitamento de raster.
- Miniaturas recentes em cache externo, sem aumentar o arquivo `.axia`.

### Atalhos principais

#### Arquivos e histórico

- `Ctrl+N`: novo; `Ctrl+O`: abrir `.axia`; `Ctrl+S`: salvar; `Ctrl+Shift+S`: salvar como.
- `Ctrl+Z`: desfazer; `Ctrl+Shift+Z` ou `Ctrl+Y`: refazer.
- `Esc` na tela inicial: retornar ao editor aberto.

#### Ferramentas

- `V`: Mover; `B`: Pincel; `E`: Borracha; `I`: Conta-gotas.
- `G`: Degradê; `Shift+G`: Balde; `C`: Recorte e seleção.
- `T`: Texto; `H`: Mão; `Z`: Zoom.

#### Seleção e camadas

- `Ctrl+A`: selecionar tudo; `Ctrl+D` ou `Esc`: desmarcar.
- Setas movem 1 pixel; com `Shift`, 10 pixels.
- `Delete`/`Backspace`: apagar seleção ou, sem seleção, excluir a camada ativa.
- `Ctrl+J`: copiar a seleção para nova camada ou duplicar a camada ativa.
- `F2`: renomear; `Alt+↑` / `Alt+↓`: elevar ou abaixar a camada.

#### Transformação livre

- `Ctrl+T`: transformar a camada ativa.
- Arraste interno move; arraste de canto redimensiona proporcionalmente.
- `Shift` alterna para escala livre; `Alt` usa o centro como origem.
- O controle circular rotaciona; `Shift` encaixa em passos de 15°.
- `Enter` ou duplo clique aplica; `Esc` cancela e restaura.

#### Zoom e navegação

- `Espaço+arrastar` ou botão do meio: navegar.
- `Ctrl+Espaço+clique`: aproximar temporariamente; `Alt+Espaço+clique`: afastar.
- `Ctrl+roda` ou `Alt+roda`: zoom suave sob o cursor.
- Com Zoom, clique aproxima e `Alt+clique` afasta.
- `Ctrl++` / `Ctrl+-`: próximo nível; `Ctrl+0`: ajustar; `Ctrl+1`: 100%; `Ctrl+2`: 200%.
- Duplo clique na Mão ajusta; no Zoom retorna a 100%.
- Roda navega verticalmente; `Shift+roda`, horizontalmente.

#### Réguas e guias

- `Ctrl+R`: mostrar/ocultar réguas; `Ctrl+;`: mostrar/ocultar guias.
- Arraste da régua cria uma guia; arrastá-la para fora do documento a remove.

No macOS, use `Command` no lugar de `Ctrl` nos atalhos correspondentes.

### Executar no Windows

Requisitos: Go 1.26.5, Node.js 24+, Wails 3.0.0-beta.12 e Microsoft Edge WebView2 Runtime.

```powershell
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.12
Set-Location frontend
npm install
Set-Location ..
wails3 dev -config ./build/config.yml
```

Build de produção:

```powershell
wails3 build
.\bin\axia.exe
```

Com as toolchains locais deste projeto:

```powershell
$env:Path = "$PWD\.toolchains\go1.23.12\bin;$PWD\.toolchains\bin;$PWD\.toolchains\node-v24.14.1-win-x64;$env:Path"
$env:GOTOOLCHAIN = "go1.26.5"
.\.toolchains\bin\wails3.exe build
.\bin\axia.exe
```

### Executar no Fedora

O instalador configura GTK4/WebKitGTK 6.0 e toolchains locais de Go 1.26.5,
Wails 3.0.0-beta.12 e Node.js 24:

```sh
./scripts/setup-fedora.sh
source ./scripts/env.sh
./scripts/wails-dev.sh
```

Gere a build com `./scripts/wails-build.sh`.

#### Executar como Flatpak

O empacotamento usa GNOME 50, com GTK 3 e WebKitGTK 4.1, e compila o backend Go
dentro do SDK. A primeira execução baixa o runtime e as ferramentas:

```sh
./scripts/flatpak-build.sh
flatpak run io.github.rodolfoaltenrath.photo-axia
```

O pacote é gravado em `dist/flatpak/Axia.flatpak` e instalado para o usuário
atual. Para remover a instalação de teste:

```sh
flatpak uninstall --user io.github.rodolfoaltenrath.photo-axia
```

O App ID é `io.github.rodolfoaltenrath.photo-axia`. O manifesto fica na raiz e
os arquivos de integração em `packaging/flatpak`. O `sudo` é usado somente pelo
`dnf`; as toolchains ficam em `.toolchains`. Em outras distribuições, instale
GTK 3, WebKit2GTK 4.1, compilador C/C++ e `pkg-config`.

### Testes

```powershell
go test ./...
go vet ./...
Set-Location frontend
npm test
npm run build
```

### Estrutura principal

- `app.go`: API nativa, importação, previews e integração com o sistema.
- `project.go`: leitura e escrita segura de `.axia`.
- `recent_projects.go`: persistência, cache e concorrência dos projetos recentes.
- `main.go`: janela e inicialização do Wails.
- `frontend/src/components`: interface Vue.
- `frontend/src/editor`: edição, histórico, seleção, guias e viewport.
- `frontend/src/services`: workers, imagens, projetos e backend.
- `frontend/src/workers`: processamento raster fora da thread principal.
- `frontend/tests`: testes automatizados do frontend.
- `frontend/bindings`: bindings TypeScript tipados do Wails v3.
- `Taskfile.yml`: tarefas de desenvolvimento, bindings, testes e build.
- `build/config.yml`: metadados e ciclo de desenvolvimento do Wails v3.

### Tecnologias e estado do projeto

Go 1.26.5 · Wails 3.0.0-beta.12 · Vue 3.5 · TypeScript 5.9 · Vite 8

O Axia está em desenvolvimento ativo. O formato `.axia` é versionado, mas
projetos importantes devem continuar com backup enquanto o editor evolui.

[Voltar à seleção de idioma](#axia)
