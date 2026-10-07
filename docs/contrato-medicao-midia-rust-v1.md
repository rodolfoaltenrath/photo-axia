# Medição de mídia no preview Rust — V1

## 1. Escopo da 29ª fatia

O caminho experimental mede custos de mídia separadamente do kernel e do PNG.
Não cria cache de RGBA/ImageBitmap, muda pixels ou ativa Rust por padrão.
Os limites intrínsecos, memória, fila, cancelamento e leases permanecem.
O protocolo Worker recebe campos opcionais; a ABI WASM e os kernels não mudam.

## 2. O que cada medida significa

| Campo | Intervalo no Worker |
| --- | --- |
| `headerMs` | Slice/arrayBuffer bounded e parsing das dimensões |
| `bitmapMs` | Await de createImageBitmap, incluindo decode/resize solicitado |
| `canvasDrawMs` | Criar canvas/contexto e desenhar bitmap ou texto |
| `readbackMs` | getImageData, sem incluir padding |
| `sourcePaddingMs` | Alocação e cópia do padding JS |
| `sourceStagingMs` | Alocação/cópia da fonte preparada para WASM |

São intervalos monotônicos de **tempo decorrido**, não tempo exclusivo de CPU.
Await inclui agendamento e trabalho do decoder nativo. Fechar bitmap/reduzir
canvas, normalização, preflights e IPC não estão todos nessas parcelas. Fetch e
espera na fila continuam nos tempos agregados do adaptador. Não somar medianas
de fases e apresentar isso como mediana do total.

`rasterDecodes`, `textDraws` e `rgbaBytes` identificam operações/pixels medidos.
Texto tem header/bitmap zero e seu desenho permanece no caminho existente.
Padrões acumulam medidas dos assets ativos deduplicados de um trabalho; não há
uma lista por arquivo, ID ou URL. Kernel e canvasUpload/pngEncode já existentes
continuam separados.

## 3. Reuso, snapshots e falhas

O staging devolve medidas da fonte. A sessão as atribui **uma vez**, à primeira
composição de mídia bem-sucedida daquela entrada. Próximas publicações recebem
`sourceReused: true`, fonte/padding/staging zerados e padrões do render atual.
Isso evita cobrar repetidamente tempos históricos só porque sourceId foi reusado.
Mudança de conteúdo/geometria/halo/qualidade que exige novo staging reinicia a conta.

Cancelamentos e erros não publicam uma amostra. Se a fonte foi preparada antes
de uma composição que falhou, sua conta pode aparecer na primeira composição
válida seguinte; não necessariamente pertence inteira ao wall time desse pedido.
Essa atribuição não é contador global de tentativas/decode nem medição de falhas.
O benchmark abaixo usa renders sequenciais válidos para não misturar esses casos.

Campos ausentes em doubles/protocolo anterior ficam `null`, não viram falsa
medição zero. O helper aceita apenas campos numéricos conhecidos, finitos e não
negativos; contadores/bytes são inteiros limitados. Metadados extras não entram
no snapshot. O serviço congela os objetos; o diagnóstico do preview devolve
cópias independentes. Fallback tem `last.media: null`, sem carregar dados do
último resultado Rust ou inventar tempos do decoder legado.

## 4. Benchmark explícito Wails/WebView2

```powershell
cd frontend
npm run benchmark:rust-media-wails
# Se o build atual já foi feito:
npm run benchmark:rust-media-wails --ignore-scripts
```

O comando compila um executável temporário com assets incorporados, usa perfil
WebView2 próprio, executa o diagnóstico e mede PNGs sintéticos **512²/1024²**.
São **dois warmups e sete amostras por cenário**, com ordem alternada:

1. `fresh-source`: nova identidade e preparo completo para cada amostra.
2. `reused-source`: setup descartado, mesma fonte preparada e render seguinte.
3. `alternating-layers`: setup de A e B descartados, volta a A exige novo staging.
4. `reused-source-pattern`: fonte preparada, padrão 512² decodificado novamente.

As cores/estilos são iguais no par fonte nova/reusada; identidade muda para forçar
o percurso. Padrão usa seu passe próprio, portanto não é controle equivalente
ao color-overlay. Setup, geração das fixtures, warmups e abertura do Worker não
entram nas amostras medidas. O gerador libera os canvases e cada render libera
sua lease; encerramento aguarda dispose do serviço. O relatório verifica formato,
dimensões, contadores e reuso, mas não é um novo golden de pixels.

Relatório tem mediana/p95 por fase, wall time completo do serviço, counts de
decode/reuso, runtime browser e Node. Com sete amostras, p95 corresponde ao maior
valor: serve como observação da cauda, não estimativa estatística robusta.
Não mede FPS, UI, handoff, fila compartilhada, documento completo, imagens
fotográficas/JPEG grandes, todas as placas/cores/fontes, RSS ou ganho por cache.

`--axia-rust-media-benchmark` só injeta o parâmetro da sonda junto ao modo
`--axia-rust-poc-smoke`. Frontend exige `axiaRustPoc=1` e
`axiaRustMediaBenchmark=1`; imports são lazy, fora do editor normal. A flag do
preview `axiaRustStyles` continua independente. O script repete o polling por
até 120 s no benchmark (30 s no smoke normal), sem elevar deadlines do serviço.

## 5. Critério para cache futuro

Manter inicialmente o cache codificado e o reuso da fonte WASM consecutiva.
Só criar cache decodificado se o tempo/latência poupável se repetir em documentos
reais e justificar memória adicional, invalidadores, eviction, ownership e
descarte durante troca de documento. Alternância entre camadas e padrões devem
ser analisados separadamente; não reutilizar chave de Blob como identidade de
raster redimensionado/estilizado. Um cache não resolve kernel/PNG/DOM por si só.

As medições locais e a decisão provisória estão na prova C1. C0/C1/C2 seguem
abertos para QA/matriz e orçamento entre janelas. C3/C4 continuam sendo a pilha
documental e a superfície única; esta sonda não substitui esses passos.
Auditoria posterior: a janela nativa atual de estilos só envia parâmetros ao
editor e não inicia outro Worker Rust. Não há teto global de RSS; coordenar
futuras instâncias concorrentes continua pendente. Detalhes no
[contrato da pilha inicial](contrato-pilha-documental-rust-v1.md#7-auditoria-do-orçamento-entre-janelas).
