# Migração para Go 1.26.5 e Wails v3.0.0-beta.12

Data da migração: 2026-08-25.

## Escopo e versões fixadas

- Go: `1.26.5` no campo `go` de `go.mod`.
- Wails: `github.com/wailsapp/wails/v3 v3.0.0-beta.12`.
- Runtime frontend: `@wailsio/runtime@3.0.0-beta.12`.
- Vue, TypeScript e Vite permanecem nas versões 3.5, 5.9 e 8.

A beta.12 requer Go 1.25 ou posterior. O projeto fixa 1.26.5 para tornar builds e
diagnósticos reproduzíveis. Referências oficiais:

- https://v3.wails.io/quick-start/installation/
- https://v3.wails.io/guides/build/building/
- https://github.com/wailsapp/wails/releases/tag/v3.0.0-beta.12

## 1. Backend

O bootstrap monolítico `wails.Run(options.App)` foi substituído por três objetos
com responsabilidades explícitas:

1. `App`, serviço de domínio do Axia;
2. `application.App`, ciclo de vida nativo;
3. `application.WebviewWindow`, janela principal.

O serviço é registrado com `application.NewService(service)`. A inicialização e a
limpeza agora implementam `ServiceStartup` e `ServiceShutdown`; o contexto recebido
é cancelado pelo Wails antes do shutdown. A limpeza continua idempotente para que os
testes possam executá-la diretamente.

Diálogos deixaram de usar funções globais de `pkg/runtime`. A migração usa
`desktop.Dialog.OpenFile()` e `desktop.Dialog.SaveFileWithOptions()`, anexando o
diálogo à janela principal. Na beta.12, o diálogo de salvar não oferece o mesmo
`SetTitle` fluente do diálogo de abrir; por isso sua construção foi centralizada em
`newSaveFileDialog`.

O antigo `OnBeforeClose` virou um hook de `events.Common.WindowClosing`. O hook
cancela o fechamento antes de abrir a confirmação, mantendo o documento seguro se
o diálogo não puder ser criado. Ao confirmar, limpa o estado sujo e fecha novamente,
sem gerar uma segunda confirmação.

## 2. Frontend e bindings

Os bindings antigos em `frontend/wailsjs` foram removidos. A geração atual escreve:

- `frontend/bindings/axia/app.ts`: métodos do serviço;
- `frontend/bindings/axia/models.ts`: interfaces derivadas dos tipos Go;
- arquivos internos de eventos: declaração tipada de `axia:files-dropped`.

As chamadas são importadas de `../../bindings/axia/app`. Eventos e APIs nativas são
importados de `@wailsio/runtime`. O detector do desktop verifica `window._wails`, não
mais `window.go`.

O file-drop mudou de `OnFileDrop` para um evento de janela no backend. A janela
emite `axia:files-dropped`, o Vue escuta com `Events.On` e o elemento raiz possui
`data-file-drop-target`, exigido pela API v3.

O gerador v3 tornou mapas Go anuláveis e seus valores opcionais no TypeScript. A
restauração de projetos agora normaliza `assetUrls` antes do uso; sem isso, um projeto
sem assets falharia na verificação estrita ou poderia quebrar em runtime.

## 3. Taskfile e desenvolvimento

`wails.json` foi removido. `Taskfile.yml` contém tarefas para:

- instalar dependências do frontend;
- executar `go mod tidy`;
- gerar bindings TypeScript;
- compilar Vite em modo de desenvolvimento ou produção;
- gerar recursos nativos do executável Windows;
- compilar, executar, testar e empacotar com NSIS.

`build/config.yml` descreve metadados, associação `.axia` e o ciclo do `wails3 dev`.
O Vite recebe `WAILS_VITE_PORT`, usa porta estrita e carrega o plugin
`@wailsio/runtime/plugins/vite` para integrar os eventos tipados gerados.

Comandos principais:

```powershell
wails3 task test
wails3 dev -config ./build/config.yml
wails3 build
wails3 task package
```

## 4. Performance e ciclo de vida

- Não enviar pixels ou blobs grandes pelos bindings JSON. O Axia já usa rotas HTTP
  internas para uploads de exportação e miniaturas, e URLs para assets; esse desenho
  foi preservado. Bindings ficam restritos a comandos e metadados pequenos.
- Workers, `OffscreenCanvas`, object URLs e o buffer duplo do canvas permanecem no
  processo da WebView. A migração não move processamento raster para o canal IPC.
- A janela principal mantém aceleração `WebviewGpuPolicyAlways` no Linux. O Wails v3
  usa GTK4 e WebKitGTK 6.0 por padrão; o caminho GTK3 é apenas compatibilidade via
  tag `gtk3` durante a série v3.0.x.
- O shutdown do serviço bloqueia até liberar sessões e tokens temporários. Goroutines
  futuras devem observar o contexto recebido por `ServiceStartup`.
- O fechamento de janela é um evento cancelável, não um callback booleano global.
  Código futuro deve usar `RegisterHook` quando precisar impedir a ação.
- `App.Run()` continua bloqueante. Janelas devem ser configuradas antes da chamada;
  operações nativas após o início precisam respeitar a thread/ciclo fornecido pela API.
- A versão é beta. APIs de pré-lançamento podem receber correções antes do v3 final;
  atualizar além da beta.12 exige regenerar bindings e repetir o roteiro completo.

No Linux moderno, instalar `gtk4-devel` e `webkitgtk6.0-devel`. Distribuições que só
tenham GTK3/WebKit2GTK 4.1 precisam de `wails3 build -tags gtk3`, uma compatibilidade
documentada como temporária até o Wails 3.1:

- https://v3.wails.io/guides/build/linux/

## 5. Roteiro de validação manual

1. Abrir, salvar e usar Salvar como em um projeto `.axia`.
2. Cancelar todos os diálogos nativos e confirmar que o estado não muda.
3. Fechar com documento limpo, com documento alterado e cancelar a confirmação.
4. Arrastar PNG/JPEG/GIF do Explorer ou gerenciador Linux sobre a janela.
5. Exportar PNG, JPEG e WebP, inclusive sobrescrevendo um arquivo.
6. Estressar zoom, pan, pincel, degradê e balde enquanto observa CPU, GPU e RSS.
7. Minimizar/restaurar repetidamente no Windows e conferir recuperação do canvas.
8. Repetir no Linux GTK4; testar `-tags gtk3` somente se a distribuição exigir.
