# Axia

Axia e um prototipo de editor de imagem desktop para Linux, construido com Go, Wails, Vue 3, TypeScript e Vite.

## Configuracao no Fedora

O instalador configura as bibliotecas nativas do Fedora, Go 1.23.12, Wails 2.12 e Node.js 24 localmente para o projeto:

```sh
./scripts/setup-fedora.sh
```

O `sudo` e usado somente pelo `dnf`. Go, Wails e Node ficam em `.toolchains`, sem alterar instalacoes globais.

Para disponibilizar `go`, `wails`, `node` e `npm` no terminal atual:

```sh
source ./scripts/env.sh
```

## Desenvolvimento

Em outras distribuicoes, instale GTK 3, WebKit2GTK 4.1, um compilador C/C++ e pkg-config. Depois execute:

```sh
./scripts/setup-go.sh
./scripts/setup-node.sh
./scripts/frontend-install.sh
```

Rode o app em modo desktop com hot reload:

```sh
./scripts/wails-dev.sh
```

Gerar build:

```sh
./scripts/wails-build.sh
```

No Linux, os scripts usam `-tags webkit2_41`, que e o caminho recomendado para distros recentes onde `webkit2gtk-4.0` nao esta mais disponivel.

## Estrutura

- `app.go`: API Go exposta ao frontend pelo Wails.
- `main.go`: configuracao da janela desktop e bootstrap Wails.
- `frontend/src`: interface Vue/TypeScript do editor.
- `frontend/wailsjs`: bindings TypeScript gerados pelo Wails.

## Recursos atuais

- Criacao de documentos em pixels ou centimetros.
- Importacao de PNG, JPEG e GIF por seletor ou arrastar e soltar.
- Selecao, movimentacao, visibilidade e opacidade de camadas.
- Transformacao livre de camadas com escala proporcional, escala central e rotacao.
- Zoom ancorado no cursor, ajuste a tela e navegacao com a ferramenta Mao, tecla Espaco ou botao do meio.
- Exportacao da composicao em PNG.
- Selecao retangular, eliptica, por laco livre e varinha magica com tolerancia configuravel.
- Exclusao destrutiva dos pixels selecionados com suporte completo a desfazer e refazer.

As ferramentas ainda nao implementadas aparecem desabilitadas para manter a interface coerente com os recursos disponiveis.

## Atalhos de navegacao

- `V`, `M`, `H` e `Z`: Mover, Selecionar, Mao e Zoom.
- `Espaco` + arrastar ou botao do meio + arrastar: navegar pela imagem.
- `Ctrl` + `Espaco` + clique: zoom temporario; `Alt` + `Espaco` + clique: reduzir temporariamente.
- `Ctrl` + roda do mouse ou `Alt` + roda: zoom suave sob o cursor.
- `Z` + clique: aumentar; `Alt` + clique: reduzir.
- `Ctrl` + `+` / `-`: proximo nivel de zoom.
- `Ctrl` + `0`: ajustar a tela; `Ctrl` + `1`: 100%; `Ctrl` + `2`: 200%.
- Duplo clique na Mao ajusta a tela; duplo clique no Zoom retorna a 100%.
- Roda do mouse: navegar verticalmente; `Shift` + roda: navegar horizontalmente.

No macOS, use `Command` no lugar de `Ctrl`.

## Transformacao livre

- `Ctrl` + `T`: transformar a camada ativa.
- Arraste dentro da caixa: mover a camada.
- Arraste um canto: redimensionar mantendo a proporcao; `Shift` alterna para escala livre.
- `Alt` + arrastar uma alca: redimensionar a partir do centro.
- Arraste o controle circular: girar livremente; `Shift` encaixa a rotacao em passos de 15 graus.
- `Enter` ou duplo clique: aplicar; `Esc`: cancelar e restaurar a transformacao anterior.

## Selecao e recorte

- `C`: ativar a ferramenta de recorte e selecao.
- Retangulo e elipse: arraste para selecionar; segure `Shift` para criar quadrado ou circulo.
- Laco livre: desenhe o contorno diretamente sobre o documento.
- Varinha magica: clique em uma cor e ajuste a tolerancia; o modo contiguo limita a area a pixels conectados.
- `Delete` ou `Backspace`: apagar os pixels selecionados da camada de imagem ativa.
- `Ctrl` + `A`: selecionar todo o documento; `Ctrl` + `D` ou `Esc`: desmarcar.
