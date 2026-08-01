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
- Zoom, ajuste a tela e navegacao com a ferramenta Mao, tecla Espaco ou botao do meio.
- Exportacao da composicao em PNG.

As ferramentas ainda nao implementadas aparecem desabilitadas para manter a interface coerente com os recursos disponiveis.
