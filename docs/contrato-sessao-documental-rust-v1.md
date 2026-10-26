# Sessão documental offscreen Rust — C3, fatia 9

Estado: **sessão persistente limitada ao consumidor experimental**, não scheduler
do preview ao vivo. Mantém os flags e a cobertura das
[fatias 7](contrato-consumidor-documental-rust-v1.md) e
[8](contrato-formas-documentais-rust-v1.md). Sem flag, o caminho padrão não muda.
Não altera ABI, algoritmos Rust, modelos editoriais ou fontes de texto.

## 1. Ownership e execução

`RustDocumentOffscreen` continua com uma transação ativa e até três pendentes,
FIFO, sem coalescer exportações. Agora conserva **um Worker e um documento DCP
preparado** entre chamadas compatíveis. Não cria um contexto por consumidor.

```text
frio → carregar mídia → conectar → preparar geração 1 → compor tiles
  → residente/inativo
    → mesma preparação: compor nova região/grade, sem carregar mídia
    → preparação diferente: release confirmado → carregar → preparar geração N+1
    → 5 s sem trabalho: descartar snapshot/handle → terminar Worker → frio
    → falha: terminar Worker → frio, ou circuito aberto até recarga
```

O release anterior ocorre **antes** de buscar/decodificar a nova mídia. O serviço
não conserva dois documentos preparados para acelerar uma troca. Falha na nova
carga não restaura o anterior; a chamada inteira usa a política de fallback
existente. A primitiva nativa de substituição atômica permanece inalterada.

Gerações crescem dentro do contexto, documentId é opaco. Confirmação de preparo
valida geração, id positivo/seguro, bytes e quantidade de camadas. Cada tile
valida id, geração, região, dimensões e tamanho do ArrayBuffer antes de pintar.
A grade do pedido atual é enviada **em todo tile**, inclusive em cache hit.

## 2. Identidade e invalidação

`rustDocumentReuse.ts` compara os snapshots limitados e já clonados, sem hash
nem serialização JSON como prova de igualdade:

- dimensões documentais e lista ordenada de camadas precisam ser idênticas;
- fonte/URL, identidade editorial/editToken, dimensões da fonte, configuração
  completa de estilos/ativos, qualidade, escala de efeitos, luz, matriz,
  opacidade e modo de mesclagem participam da comparação;
- geometria/cor/alfa/origem de forma e cor do fundo também participam;
- ordem de propriedades de objetos não importa; presença de campos, valores,
  ordem/comprimento de arrays e distinções de `Object.is` importam.

Dimensões **de saída** e grade não são identidade de fonte preparada. A fonte
continua completa, sem recorte no tile/conta-gotas. O serviço volta a validar
tamanhos/bytes da saída, origem finita e escala **1:1** antes de admitir o
pedido, mesmo se houver cache. Não libera escala/minificação não validada.

Na [fatia 10](contrato-aparencia-mesclagem-rust-v1.md), a política `appearance`
usa um domínio normalizado de clipping. Suas dimensões e fontes transladadas
participam da identidade; a exclusão acima da grade de saída não permite
reutilizar uma preparação isolada com bounds/fontes diferentes.

O adapter editorial ainda elimina camadas que não intersectam a região pedida.
Se essa seleção muda, há nova preparação. Não tentar reutilizar um documento
parcial como se contivesse camadas que não foram preparadas. Não há ainda cache
incremental por camada, revisão global do modelo ou atualização por delta.

Reuso de pixels só é permitido se **todas** as fontes raster e padrões/texturas
ativos forem URLs `blob:` ou `data:`, imutáveis no contrato do editor. URLs HTTP,
relativas, de arquivo ou outros protocolos são recarregadas a cada chamada; o
documento é liberado ao terminar, embora o Worker possa permanecer disponível.
Não usar a igualdade de uma URL mutável como versão de pixels. Revogar uma URL
não é protocolo de revisão: mudanças editoriais precisam atualizar a referência
ou identidade correspondente, como no contrato de mídia existente.

## 3. Limites, falhas e encerramento

- Uma preparação residente, mesmos limites DCP/STG1 de 64/96 MiB e de fontes,
  assets, Blobs e quotas das fatias anteriores; não adiciona outro cache RGBA na
  UI. A preparação não retém os Blobs codificados no serviço após o job.
- Snapshot residente até 1 MiB, além de um ativo e três pendentes com o mesmo
  teto individual. Esses são limites lógicos de metadata, não medição de heap.
- Timeout ativo continua 30 s, incluindo carga/conexão/preparo/tiles; espera na
  fila e inatividade não são trabalho ativo. RPC continua com seu timeout de
  10 s. Timeout/indisponibilidade encerram contexto, rejeitam fila e impedem
  novas tentativas nessa instância até recriar o serviço/recarga.
- Cinco segundos inativo encerram o Worker, liberando também o pico de memória
  linear WASM. `release-document` sozinho não promete reduzir o heap do runtime.
  Testes podem configurar o intervalo entre 0 e 60 s; não há opção de UI nova.
- Se chegar trabalho durante a terminação, ele aguarda na fila limitada. Só
  despachar depois do término drenado; falha de término interrompe o serviço.
  Erro de pintura/preparo/protocolo invalida o residente e encerra o contexto.
- Dispose é idempotente, aborta ativo/fila e remove timers. Conexão tardia é
  terminada; confirmação tardia não restaura cache; tile tardio não pinta.

O módulo público lazy drena a instância anterior antes de criar outra. `pagehide`
descarta a sessão; uma chamada iniciada antes desse descarte não pode reabri-la
ao retomar um `await`. Uma abertura posterior pode criar sessão nova, após
cleanup, sem depender de um singleton permanentemente parado.

`rustDocumentRendererStats()` expõe apenas contagens de conexões, preparações,
reusos e chamadas concluídas, ativo/fila, disponibilidade de Worker e bytes preparados.
Não expõe URLs, pixels, texto ou dados de usuário. É diagnóstico, não telemetria.

Não é orçamento global de processo/janelas, cancelamento público por consumidor,
prioridade de preview, dirty regions ou modelo/histórico em Rust. Instâncias
privadas não compartilham admission. Os flags continuam mutuamente exclusivos
na inicialização; mudar query dinamicamente não é rollout suportado.

## 4. Provas e gates restantes

- Testes de identidade verificam alterações de conteúdo, documento, ordem,
  estilos, luz, transformações e formas; URLs externas/padrões bloqueiam cache.
- Worker/WASM real, com decode/Canvas doubles identificados, verifica regiões
  distintas, alfa/Fill, gerações, release, fonte externa, falhas, fechamento
  inesperado, fila durante terminação, inatividade, confirmação/tile tardio,
  timeout e dispose. Não são provas de geometria ou decode reais.
- Oráculo browser mantém três goldens, 24 DCP3, dois documentos editoriais e
  24 formas. Nos dois documentos editoriais, seis chamadas PNG/Blob/cor usam
  **uma conexão, duas preparações e quatro reusos**. Os 24 documentos de formas
  mudam a preparação sem abrir outro Worker. Tolerâncias não mudam.
- Diagnóstico Wails exige um contexto documental, duas preparações e dois
  reusos para Blob/cor de imagem estilizada e forma; encerra explicitamente a
  sessão antes de concluir.

Ainda faltam texto/fontes, minificação/escalas, demais consumidores, scheduler
documental incremental/cancelamento público, admissão agregada, superfície única
C4, medições de FPS/RSS e QA manual antes do rollout e retirada do legado.

## 5. Validação local — 2026-10-19

- Frontend **602/602**, com cinco testes novos de identidade; typecheck do app
  e das suítes passou. WASM/Worker **435/435**: **429** scripts, cinco casos
  standalone WASM e um standalone Worker. Há 14 testes novos de sessão usando
  o Worker/WASM real e fixtures de mídia identificadas.
- O subconjunto de **33 testes** de identidade/mídia/sessão passou três vezes,
  incluindo timeout, respostas atrasadas e entrada na fila durante terminação.
  Rust nativo **132/132**, `go test ./...`, build Vite e integridade do bundle
  passaram. Não houve alteração dos algoritmos/ABI Rust.
- Oráculo real passou: três goldens preservados, 24 DCP3, dois documentos
  editoriais PNG/Blob/cor e 24 formas. O caminho documental fez **30 chamadas
  com uma conexão, 26 preparações e quatro reusos**; depois provou rejeição
  de chamada obsoleta no descarte, reabertura limpa e novo cleanup. Máximos
  de alfa/RGB premultiplicado: editoriais **1/1,0510**, formas **1/1,9765**.
  As tolerâncias continuam **2/3**, sem regravar referência.
- Diagnóstico Wails incorporado passou com reuso real entre Blob/conta-gotas.
  Smokes do preview normal, estilos Rust opt-in e fallback forçado passaram
  com `lostActive=false`; o preview Rust manteve um Worker para três consumidores
  e zerou leases no cleanup. Não houve mudança do preview padrão.
- Bundle conserva `axia_pixel_core-BfefQY4S.wasm`, **124718 bytes**, e Worker
  `rustPixelPoc.worker-TnbjmuHD.js`, ambos íntegros. Ambiente: Node **24.14.1**,
  Rust **1.98.1**, Go **1.26.5**, Windows **10.0.26200**, Edge do oráculo
  **155.0.4283.45** e WebView2 **155.0.4283.62**.

Sem benchmark novo de FPS/RSS, validação manual, distribuição, mudança de versão,
ativação por padrão ou exclusão de legado. Contagens provam trabalho evitado e
ciclo de vida, não uma porcentagem de aceleração para documentos reais.
