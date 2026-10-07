# Pilha estilizada e cache documental WASM — C3, fatia 5

Estado: **ABI privada SDP1, runtime e Worker experimentais implementados**.
Liga a [preparação nativa](contrato-pilha-estilizada-rust-v1.md) ao WASM e mantém
um pacote documental preparado residente para renders regionais. Não há ainda
consumidor editorial, scheduler documental, mudança do preview padrão ou
substituição de `renderDocument.ts`/DOM. C3/C4 continuam abertos.

Relacionado a [DCP1](contrato-abi-pilha-documental-rust-v1.md),
[DCP2](contrato-transformacoes-documentais-rust-v1.md),
[STG1](contrato-estagios-v1.md) e ao
[roadmap](roadmap-compositor-rust-internacionalizacao.md).

## 1. Fluxo e responsabilidade

```text
fontes RGBA com padding + geometria DCP1/DCP2 + planos STG1 por camada
  → envelope SDP1 transferido ao Worker
  → validação conjunta → estilos Rust executados uma vez
  → pacote DCP preparado residente no WASM
  → pedidos de região/grade → mesmo compositor documental → RGBA próprio
```

`encodeStyledDocument(job, plans)` exige uma lista densa, com uma entrada por
camada, em ordem inferior → superior. `null` significa fonte sem estilo; um
plano vazio ainda aplica conteúdo/Fill conforme STG1. Não inferir estilo pelo
alfa nem executar efeitos novamente quando chega um tile.

O resultado da preparação é um DCP1/DCP2 com os mesmos descritores e fontes
substituídas por RGBA estilizado. Não contém STG1 nem empresta buffers da entrada.
Camadas ocultas ou com opacidade zero têm seus estilos validados, mas conservam
a fonte original sem executar passes. Camadas visíveis fora da região inicial
são preparadas, pois outro tile pode precisar delas.

Geometria, visibilidade, opacidade, blend, fontes e aparência são imutáveis nessa
preparação. Alterá-los exige preparar novamente. Região e grade de saída podem
mudar sem reaplicar os estilos; zoom/pan não reenvia RGBA ao WASM. O runtime
altera apenas o pequeno cabeçalho DCP durante a chamada síncrona e o restaura em
`finally`, inclusive após erro ou crescimento da memória.

O chamador continua responsável por padding/insets, matriz corrigida, resolução
da fonte e unidades dos efeitos. Mudar a grade de saída não redesenha texto nem
produz informação ausente no raster preparado. Qualidade de texto, minificação
e adapters editoriais continuam gates separados.

## 2. Envelope binário SDP1

Little-endian; offsets relativos ao começo do envelope. Sem ponteiros nos
descritores. Header de **32 bytes**:

| Offset | Campo | Regra |
| --- | --- | --- |
| 0 | magic, 4 bytes | ASCII `SDP1` |
| 4 | version, u32 | `1` |
| 8 | headerBytes, u32 | `32` |
| 12 | layerCount, u32 | Até `1024`, igual ao DCP interno |
| 16 | documentOffset, u32 | `32 + layerCount * 8` |
| 20 | documentBytes, u32 | Comprimento exato do DCP interno |
| 24–31 | reservado | Todos zero |

Segue uma tabela de **8 bytes por camada**: offset STG1 u32 e comprimento u32.
Sem estilo é exatamente `0/0`. Entradas com estilo têm comprimento mínimo de
32 bytes e múltiplo de 8; ficam contíguas na ordem das camadas, imediatamente
após o DCP. Não aceitar gaps, alias, padding entre pacotes ou bytes finais.

O DCP1 ou DCP2 completo fica imediatamente após a tabela, preservando seu
layout/validação. O envelope tem comprimento múltiplo de 4 e até **64 MiB**.
Um STG1 pode começar em endereço não alinhado a 8: decodificação usa leituras
little-endian de bytes, não casts alinhados.

Novo export, **cinco argumentos**:

```text
axia_poc_document_prepare_styles(
  packetPtr, packetLen, outputPtr, outputLen, residentExtra
) → status u32
```

`outputLen` é exatamente `documentBytes`, não o tamanho de um tile. A saída é
o DCP preparado. `residentExtra` cobra os bytes do cache anterior durante uma
substituição transacional. Entrada e saída usam pares vivos do allocator WASM,
sem sobreposição; não existe registro de alocações para validar ponteiros
arbitrários. O chamador deve cumprir esse contrato de segurança.

| Status | Significado |
| --- | --- |
| 0 | Sucesso |
| 1 | Comprimento/layout inválido |
| 2 | Configuração ou pacote interno inválido |
| 3 | Ponteiro nulo |
| 5 | Sobreposição de entrada/saída |
| 6 | Orçamento/reserva de memória |
| 7 | Quota de trabalho |

O adapter nativo só escreve a saída depois de todos os estilos terminarem.
Não altera a entrada. O export documental regional de quatro argumentos,
DCP1/DCP2 e STG1 continuam iguais. A consulta de versão documental continua
retornando `2`; SDP1 é uma capacidade separada, detectada pelo novo export de
cinco argumentos. WASM antigo ainda atende suas operações anteriores, mas não
pode preparar SDP1 (`wasm-unavailable`). Não é a ABI pública definitiva.

## 3. Cache, geração e ownership

O runtime mantém **um** DCP preparado, com `documentId` opaco e metadados:
`generation`, `bytes`, `layerCount`, `preparationMs`. O ID não é ponteiro WASM.
O contador de IDs é monotônico no módulo Worker e não reaproveita IDs ao
reinicializar seu runtime; IDs não são persistidos nem portáveis entre Workers.

API experimental:

```text
prepareDocumentPacket(envelope, generation) → metadata
composePreparedDocument(documentId, region, grid?) → RGBA + metadata/timings
documentMetadata(documentId) → metadata
releaseDocument(documentId)
dispose()
```

Geração é inteiro seguro positivo e deve superar a última preparação bem
sucedida no runtime. Uma tentativa falha não avança esse marco: pode ser
repetida com a mesma geração. Liberação não permite voltar a uma geração antiga.

Preparação nova mantém o cache anterior até validar/executar o novo pacote.
Falha de alocação, quota ou kernel libera os temporários e conserva ID, pixels
e geração anteriores. Sucesso libera o pacote antigo e publica o novo ID.
Liberação exige o ID atual; ID obsoleto/inexistente é `invalid-input`.
Dispose é idempotente e libera o pacote residente.

Renders alocam somente a saída do tile no WASM e devolvem uma cópia RGBA própria,
transferível pelo Worker. Essa cópia permanece válida após release/dispose.
`copyInMs = 0` significa ausência de upload de fontes nessa chamada; não significa
ausência de escrita dos pequenos metadados do cabeçalho. DCP1 não aceita grade
de saída alternativa; DCP2 usa a grade preparada quando `grid` é omitido.

Neste runtime experimental, cache documental e fonte individual staged de
estilos são **exclusivos**. Preparar documento enquanto há fonte individual ou
preparação assíncrona em andamento é rejeitado. Preparar fonte individual com
documento residente também é rejeitado, sem descartá-lo. É necessário liberar
explicitamente antes de trocar de contexto. `invalidateSource` não libera o
documento. Isso evita residência dupla não coordenada; não substitui o futuro
scheduler/admission compartilhado entre consumidores.

## 4. Memória e trabalho

Preparação admite até **96 MiB** de trabalho agregado:

```text
envelope SDP1 + saída DCP preparada + cache DCP anterior
  + saída planejada da região inicial
  + todas as fontes estilizadas a reter
  + 2048 bytes por efeito + 512 bytes por camada
  + max(2 * bytesDaFonteEstilizada + picoDeFiltros + 2048)
```

Fontes originais e STG1 já estão no envelope: não cobrá-los novamente na reserva
adicional ao preparador nativo. Cobrar saída e cache anterior integralmente,
mesmo durante a troca. Há ainda os limites existentes por pacote/raster, por
eixo e por camada; um conjunto admissível isoladamente pode exceder o agregado.

O encoder tipado calcula os planos e o pico dos filtros antes de alocar o
envelope grande. Para pacote binário recebido, o preflight TypeScript valida
estrutura e calcula um **mínimo**, sem decodificar todos os parâmetros internos
dos efeitos. A validação Rust é autoritativa: confere todos os STG1, parâmetros,
pico completo e quotas antes de alocar os rasters temporários.

Quota de preparação: até **16 * 1024 * 1024 pass-pixels**, somando por camada
executada `width * height * (efeitos + conteúdo + filtro Esta camada opcional)`.
Continua a quota documental independente de amostras transformadas por região.

Após preparar, só o DCP resultante permanece alocado no WASM: envelope, planos
e fontes temporárias são liberados. Cada tile cobra pacote residente, saída e
metadata do compositor. Operações stateless antigas também somam esse cache a
suas verificações de memória; não ganham um orçamento independente de 96 MiB.

Esses limites são admission lógica, não RSS físico, teto das páginas retidas
pelo allocator, garantia de FPS ou recuperação de OOM do SO. JS pode possuir
cópias adicionais de entrada/resultado. Orçamento entre instâncias e janelas,
pressão real de memória e granularidade por camada/dirty region continuam
pendentes antes de ligar o fluxo ao editor.

## 5. Worker e cancelamento

Novos pedidos: `prepare-document`, `compose-prepared-document`,
`release-document`. Preparação recebe `ArrayBuffer` transferível (não aceita
`SharedArrayBuffer`); resultado regional transfere seu próprio RGBA. Respostas
incluem ID e geração para correlação.

Prepare/release são barreiras de ciclo de vida: cancelar sua promise não pode
deixar um estado residente invisível para o chamador. O cliente não os trata
como renders canceláveis. Tiles seguem o mecanismo existente de descarte de
pedidos cancelados. O kernel é síncrono; cancelamento não preempta o cálculo
Rust em andamento. Revisões editoriais e descarte visual de resultados antigos
precisam ser implementados no futuro consumidor/scheduler, não inferidos do ID.

## 6. Provas locais — 2026-10-07

- Rust **122/122**; **61/61** casos documentais em release, incluindo seis casos
  novos do adapter SDP1. `cargo fmt --check` passou.
- Frontend **587/587**, typecheck do app e das suítes passaram.
- WASM/Worker **397/397**: **391** scripts, cinco casos standalone WASM e um
  standalone Worker. Doze testes novos de pilha preparada cobrem os dez efeitos,
  padrões/texturas, duas camadas com alpha parcial, seis modos, padding/rotação,
  grade fracionária e tiles 1/2/3/7 contra os kernels anteriores separados.
- Subconjunto de **40 testes** (SDP1, DCP1/DCP2 e RPC) passou **três vezes**.
  A versão final do caso dos dez efeitos inclui backdrop com alpha parcial.
- Instrumentação verifica uma preparação para vários tiles, um único par
  residente, ausência de reupload, crescimento de memória, restauração de
  cabeçalho, falhas de alocação/kernel, troca atômica e liberação única dos pares.
  É fault injection do adapter/runtime; não do allocator nativo/SO.
- Build e bundle passaram: `axia_pixel_core-D6BaYUCu.wasm`, **122768 bytes**,
  íntegro contra Cargo; Worker `rustPixelPoc.worker-DNTrtwQz.js`. Aviso existente
  de chunk JS acima de 500 kB permanece, sem falha de build.
- `go test ./...` passou. Diagnóstico Wails/WebView2 incorporado exercitou
  preparação SDP1, dois tiles reutilizados, transferência e liberação explícita.
  Smokes de preview normal, Rust opt-in e fallback forçado passaram sem perda do
  estado ativo. No Rust, três consumidores preservaram um Worker; limpeza zerou
  leases/cache. Esses smokes preservam o preview atual, não o migram para SDP1.
- Ambiente: Node **24.14.1**, Rust **1.98.1**, Go **1.26.5**, Windows
  **10.0.26200**, WebView2/Edge **154.0.4258.62**.

Não há medida de ganho de FPS no editor, QA manual do usuário, instalador,
portável ou remoção de legado nesta entrega. Os smokes limparam seus executáveis
temporários. Próximos gates: `Blend If` subjacente sobre backdrop, minificação/
paridade Canvas, preparação editorial, scheduler/revisões/admission e primeiro
consumidor offscreen atrás de flag; depois superfície única C4.
