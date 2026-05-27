# Axia

Axia e um prototipo de editor de imagem desktop para Linux, construido com Go, Wails, Vue 3, TypeScript e Vite.

## Requisitos

- Go 1.22+.
- Wails CLI v2.
- Node.js 24 LTS. O projeto inclui scripts para usar Node local em `.toolchains`, sem instalacao global.

## Desenvolvimento

Instale as dependencias do frontend:

```sh
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
