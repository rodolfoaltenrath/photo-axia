# Cache de mídia codificada do preview Rust — V1

## 1. Escopo da 27ª fatia

O preview opt-in compartilha um cache LRU de **Blobs codificados de fontes e
padrões** por janela/contexto documental. Não guarda RGBA, ImageBitmap, Canvas,
PNG de resultado ou fontes tipográficas. O Rust continua calculando efeitos e
gerando PNG novo em cada render. `fromCache` continua false: reuso de mídia não
é hit de composição. Texto/exportação/miniaturas/ABI/`.axia`/versões não mudaram.

`rustStylePreviewMediaCache.ts` implementa retenção/LRU; a preparação fica em
`rustStylePreviewPreparation.ts`; `rustStylePreview.ts` administra orçamento,
ownership e limpeza. A factory browser permanece lazy, fora do caminho padrão.

## 2. Identidade e frescor

Fontes têm slot `source:<consumerId>`, com versão compacta monotônica do adaptador
e comparação exata da URL. A versão deriva da comparação **exata** da identidade
editorial, não de hash/truncamento. Mudança de pixels exige nova URL ou editToken/
identidade, como já exigia a sessão. Mudanças somente de estilo mantêm a versão.
Camadas distintas não compartilham slot; contexto novo/remount ganha outra época.

Padrões têm slot `pattern:<assetId>` e comparação exata de URL/dimensões. O mesmo
asset pode ser compartilhado entre efeitos/camadas. Mesmo ID com URL/dimensões
diferentes substitui a entrada; conflitos no mesmo pedido falham antes da leitura.
IDs especiais, inclusive `__proto__`, ficam como propriedades próprias num record
sem protótipo. Só assets ativos são preparados; textura desabilitada não é buscada.

Somente `blob:`/`data:` são elegíveis, por representarem conteúdo local imutável.
HTTP, caminhos relativos e outros protocolos sempre passam pela leitura bounded;
não recebem cache eterno sem revisão de conteúdo. Fonte Blob direta/texto não
entram no cache. Identidade editorial extensa não vira chave de retenção.

## 3. Limites e admissão

| Conta | Limite padrão |
| --- | --- |
| Retenção de mídia + metadados UTF-16 | 32 MiB |
| Entradas LRU | 64 |
| Blob codificado por leitura | 64 MiB |
| Soma de padrões no pedido, inclusive hits | 64 MiB |
| Orçamento anterior do preview/serviço | 256 MiB, não aumentado |

Cada entrada cobra `blob.size + 2 × (key.length + version.length + url.length)`.
Entrada que não cabe é devolvida ao trabalho, mas não retida; não torna mídia
válida inválida. Inserção retira os menos recentes até caberem bytes/quantidade;
hit promove a entrada. URL data extensa entra na conta, incluindo base64.
Capacidade zero desativa retenção sem impedir preparação, para testes/adaptadores.

A capacidade é reservada **antes da factory**, não somada ao teto do serviço:

```text
serviço: 256 MiB − 32 MiB de cache − PNGs de contextos anteriores
```

O serviço browser fica em 224 MiB, menos PNGs antigos. PNGs publicados conservam
o limite conjunto de 64 MiB/64 leases. Blob emprestado ao pedido é cobrado como
entrada mesmo se também estiver no cache, conservadoramente. A reserva fixa não
cresce ao retirar entradas, evitando corridas de admissão. Eviction não libera
a conta da entrada ativa. Cache legado e orçamento de outras janelas são separados.

Hits também verificam abort e limite restante. Cache não contorna preflight,
soma de assets ou orçamento de decode/kernel/PNG. Miss usa stream bounded,
não `response.blob()` sem limite nem loaders editoriais arbitrários.

**Não é RSS.** Exclui overhead real do heap, cópias de Blob/rede, Canvas/decoder,
memória WASM já crescida, buffers internos do decoder, legado e outras
janelas. A [28ª fatia](contrato-limites-decode-preview-rust-v1.md) limita o raster
intrínseco lógico antes do resize; RSS/orçamento global continuam pendentes.

## 4. Cancelamento, eviction e teardown

Preparação continua exclusiva na fila. Não há pool novo, coalescência de fetches
ou cache de Promises rejeitadas. Erro/Blob vazio/oversize não produz entrada;
próxima leitura válida pode recuperar. Abort depois de loader que ignore signal
também impede retenção. O adaptador continua barrando publicação obsoleta.

Época impede fill antigo de recolocar mídia após clear/reset. Apenas o fill
cacheável mais recente pode inserir, protegendo contra resposta fora de ordem.
Retirar consumidor invalida seu fill de fonte. Não há mapa ilimitado de fills;
essa guarda é defensiva, pois o caminho real permanece serializado.

Remover/ocultar A retira sua fonte e conserva fontes de B/padrões compartilhados.
Falha local retira fonte do dono; falha comum, último consumidor e reset limpam
tudo. Padrões sem uso imediato podem ficar no LRU até eviction/clear, dentro do
limite. Mostrar a camada solicita a versão atual.

Eviction/clear retiram referências: não revogam URLs editoriais, não alteram
Blobs emprestados, não encerram Worker de outra camada e não revogam PNG do
handoff. Lease publicada permanece válida/liberável após dispose.

## 5. Instrumentação e validação

Diagnóstico opt-in inclui `mediaCache`: hits/misses/loads/evictions, entradas,
bytes lógicos e capacidade, sem URLs/IDs editoriais/texto. Contadores são
cumulativos; clear zera entradas/bytes. Hit mede reuso de bytes, não ganho de FPS.

Testes puros cobrem limites/metadados/LRU/versão/URL/protocolo mutável, abort,
clear/release tardios e empréstimos. Preparação cobre assets ativos/compartilhados,
IDs especiais, fontes diretas/texto e soma incluindo hit. Worker/WASM reais com
doubles explícitos de mídia/Canvas/encoder verificam pixels novos após edição
e isolamento entre contextos. Smoke Wails exige hit ao editar estilo sem novo
load, Worker único, handoff intacto e cache vazio após último consumidor.

QA manual: editar estilo/conteúdo, compartilhar/substituir padrão, ocultar/
mostrar, remover durante preparo, undo/redo e trocar documento. Conferir também
fallback/default. Checks sintéticos não substituem QA ou benchmarks repetidos.

Próximos passos: QA dos limites intrínsecos e medição de decode antes de decidir cache
de pixels/padrões decodificados com ownership próprio. Não contabilizar RGBA
como se fosse Blob codificado. C0/C1/C2 continuam abertos; C3/C4 não substituíram
pilha/DOM/exportação. Resultados registrados na prova C1, 27ª fatia.
