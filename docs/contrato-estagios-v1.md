# Executor regional de estilos V1 — experimental

Estado: executor Rust/WASM de **uma camada com fonte preparada**, não compositor
da pilha do documento. Complementa o [contrato lógico](contrato-compositor-v1.md).
Preview normal, exportação, texto, Go/Vue e `.axia` continuam inalterados.

## Entrada e ordem

Fonte RGBA8 original staged uma vez, na grade completa com padding/insets
preparados pelo chamador. Região absoluta inteiramente dentro da grade;
saída RGBA8 compacta. A escala já foi resolvida nos parâmetros dos efeitos.
Não acrescentar/recortar padding dentro do kernel nem transformar a origem
dos gradientes/texturas conforme o tile.

`prepareRustStyleStages` recebe configuração **normalizada**, luz/escala e
assets decodificados, e usa `buildLayerStylePipeline` para preparar os dez
tipos atuais. O efeito editorial original não muda. Efeitos desabilitados ou
com opacidade zero seguem a filtragem existente. Padrão sem asset é no-op;
asset ativo sem decode é erro. Texto/forma ainda produzem fonte pelo caminho
atual; este executor não faz shaping nem rasterização vetorial.

Ordem obrigatória:

```text
externos → conteúdo com Fill → internos → overlays → superiores → Esta camada
```

Preservar ordem dentro de cada estágio, inclusive bisel/traçado. Nunca usar
ordem do array original para atravessar estágios. O pacote deve chegar
ordenado; o kernel rejeita reversão de estágio em vez de reordenar sozinho.

Começar com target transparente. Externos usam a máscara original; conteúdo
é source-over normal sobre o acumulado, com alfa `round(originalAlpha *
(Fill/100))`. **Não substituir o target por uma cópia com Fill**: isso apagaria
sombras externas e quebraria fonte com alfa parcial. Conteúdo é aplicado
exatamente uma vez, mesmo sem efeitos externos ou posteriores.

Todos os efeitos usam o alfa original, não o alfa modificado pelo Fill ou
pelos passes anteriores. Cada passe mantém seu próprio arredondamento e
contrato. Esta camada lê as cores estilizadas e filtra depois dos superiores.
Faixa padrão pode ser omitida pelo preparador. Camada abaixo permanece em
passe separado, depois da transformação/obtenção do backdrop documental.

## Execução e atomicidade

Uma chamada ao kernel por tile, pacote copiado uma vez e uma única saída
copiada de volta. Dois buffers compactos Rust alternam entre passes; não há
reupload da fonte nem retorno ao JS entre efeitos. Conteúdo modifica o
acumulado in-place. Não há cache automático de filtros ou textura.

Preflight valida todos os comandos, estágios, configurações, payloads e
orçamento; só então reserva os dois buffers compactos. Cada filtro usa seu
halo regional anterior e os limites completos da fonte. Fonte não é alterada.
Saída externa só recebe bytes após todos os passes/filtro terminal terminarem.
Erro tardio ou reserva interna falha não publica pixels parciais. RAII/finally
liberam temporários e a fonte staged continua reutilizável.

Reutiliza os kernels anteriores e seus parsers. Overlays compartilham o parser
e `Effect::apply` do lote AXB1, mas **não** executam seu Fill. Validações dos
outros subpacotes são usadas no preflight e novamente pelo passe individual.
Não modificar a aritmética dos efeitos durante esta integração.

## Pacote STG1

Little-endian, cabeçalho 32 bytes, até 64 registros de 16 bytes. Payloads
contíguos na ordem dos registros; cada início alinhado a 8 bytes, padding
final zero. Comprimento total exato, até 64 MiB; sem gaps, alias ou bytes
extras no envelope externo.

| Header offset | Campo |
| --- | --- |
| 0 / 4 | Magic u32 0x31475453 (`STG1`) / versão u32 = 1 |
| 8 | Count u32, 0..64 |
| 12..15 | ShadowStart/End, HighlightStart/End u8 de Esta camada |
| 16 | Fill f64 finito 0..100 |
| 24 | Filtro terminal u32, 0 ou 1 |
| 28 | Canal u32 gray/red/green/blue = 0..3 |

Sem filtro, bytes 12..15 e canal são zero. Com filtro, valores são ordenados
em [0,255] conforme o contrato existente. Registro em `32 + i*16`:
kind u32, stage u32, payloadOffset u32 e payloadLength u32.

| Kind | Stage | Subpacote |
| --- | --- | --- |
| 1 | 0 externo | SHD1 — sombra externa |
| 2 | 0 externo | GLW1 — kind outer |
| 3 | 2 interno | SHI1 — sombra interna |
| 4 | 2 interno | GLW1 — kind inner-edge/inner-center |
| 5 | 2 interno | SAT1 — acetinado |
| 6 | 3 overlay | AXB1 com exatamente um overlay |
| 7 | 4 superior | BEV1 — bisel/relevo |
| 8 | 4 superior | STK1 — traçado |

Stage 1 é conteúdo implícito, não aceita registro. Kind desconhecido, estágio
incompatível ou ordem regressiva são erros. GLW1 deve combinar com estágio;
SHD1 e SHI1 não são intercambiáveis. AXB1 aninhado exige Fill zero e nenhum
filtro terminal; cores/gradiente/padrão conservam seu contrato anterior.
BEV1/texturas RGBA com comprimento não múltiplo de 8 recebem padding **fora**
do subpacote; seu comprimento original permanece no registro.

## Memória e ABI

`axia_poc_style_stages_region` tem 12 argumentos:

`sourcePtr, sourceLen, sourceW, sourceH, x, y, width, height, packetPtr, packetLen, outputPtr, outputLen`.

Somente pares vivos do allocator privado. Não recebe ponteiros de arquivos
ou mods. Fonte/saída/pacote até 64 MiB cada, geometria exata, output não pode
sobrepor fonte/pacote. Status: 0 sucesso, 1 comprimento/geometria/offset,
2 versão/comando/configuração/estágio, 3 null, 5 overlap, 6 orçamento/reserva.
Adapter usa memory-limit para 6; falha de allocator externo usa wasm-failure.

Orçamento conservador por job até 96 MiB, verificado no TS **antes de
materializar/copiar texturas ou alocar no WASM**, e no Rust antes dos filtros:

```text
sourceBytes + packetBytes + 3*tileBytes + count*2048 + max(filterBytesPorPasse)
```

Três tiles = saída externa e dois buffers internos. Metadados/paradas já
decodificados de overlays permanecem vivos e entram em count*2048. Filtros
são sequenciais: cobrar o **pico**, não a soma. Um passe que isoladamente cabe
pode ultrapassar o limite do executor por causa do tile adicional; não omitir
esse buffer nem reutilizar saída externa antes de completar a transação.

| Passe | Filtros temporários no pico |
| --- | --- |
| Sombra/brilho | 2*C + 4*A se spread > 0; apenas 2*C sem spread |
| Acetinado | 3*C |
| Bisel | 2*C |
| Traçado | 3*C + [4*C + 20*A + 8 se externo > 0] + [4*(A+2*interno) se interno > 0] |
| Overlay / traçado sem padrão configurado | 0 |

C = pixels do contexto próprio do passe, A = seu maior eixo. Halo é o do
contrato individual, incluindo R+S+1 do bisel. O guard i32 da EDT permanece.
Contabilidade não é RSS, páginas retidas WASM, cópias JS nem orçamento global.
Textura compartilhada por dois efeitos ainda é incluída duas vezes no pacote;
um único transfer de ArrayBuffer no Worker não é cache/deduplicação de assets.

## Worker, validação e pendências

`style-stages-staged-region` recebe sourceId/região/plano e retorna
rendered-staged-region. Fonte staged, geração, ID atual e revisão de vista/
aparência continuam obrigatórios para publicar. Lifecycle preserva invalidate,
release e dispose; cancel não interrompe kernel síncrono já ativo.

Goldens existentes, seis modos com os dez tipos combinados, Fill fracionário,
ordem invertida no array editorial, tiles, 64 efeitos, flags, alocação/kernel
falhando, comando final inválido e worker real. Sonda e smoke Wails/WebView2
na [prova C1](prova-rust-wasm-c1.md).

Próximo passo: preparação/insets e cache ligados ao fluxo real, mantendo
invalidação e limites. Ainda faltam pilha/backdrop, transformações, compositor
offscreen único, preview de superfície única e QA end-to-end/multiplataforma.
STG1 é experimental; C0/C1/C2 não são gates encerrados por esta fatia.
