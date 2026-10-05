# Máscara alfa regional — ABI experimental V1

Implementada em 2026-10-05. É uma base para sombras/brilhos, não um efeito
completo nem o compositor do documento. Preview normal e exportação não mudam.

## Operação e parâmetros

`alphaMaskStagedRegion(sourceId, region, config)` lê somente o alfa da fonte
RGBA8 preparada e devolve um tile RGBA8 compacto: RGB zero, alfa filtrado.
Não consultar RGB, fill da camada ou o resultado de uma sobreposição anterior.
Sem filtros, preserva exatamente o alfa original, inclusive valores parciais.

- `spreadRadius`: inteiro de 0 a 4096, na grade física da fonte preparada.
- `blurRadius`: inteiro de 0 a 4096, na mesma grade.
- `precise`: booleano. Não representa qualidade de texto ou zoom da câmera.
- Região positiva dentro da fonte, bordas semiabertas; coordenadas inteiras.
  A saída tem `width * height * 4` bytes e a geração da fonte.

O chamador converte tamanho/escala documental e spread percentual para raios
antes de solicitar o kernel. Raios inválidos não são normalizados ou limitados
silenciosamente. Esse teto experimental não implica cobertura de todo estilo
em toda resolução. Não usar a máscara RGBA preta como resultado visual do estilo.

### Semântica numérica

Spread aplica máximos horizontal e vertical, com fila monotônica linear por
linha. Preserva a expansão **quadrada** do `spreadAlpha` atual; não é o spread
circular usado pelo traçado. Blur aplica médias móveis horizontal e vertical
com zero fora da fonte e divisor fixo `2 * raio + 1`, sem renormalizar nas bordas.

Cada eixo materializa bytes usando arredondamento half-up antes do próximo.
Preciso usa um par horizontal/vertical de raio `r`. Suave usa três pares de
raios `floor(r/3)`, `floor((r+1)/3)`, `floor((r+2)/3)`, omitindo zeros.
A soma dos raios é `r`; não fundir os arredondamentos nem trocar por um blur
gaussiano, ainda que pareça visualmente semelhante.

### Contexto e halo

O suporte necessário é `spreadRadius + blurRadius` em cada direção. O kernel
expande a região de saída por esse suporte e intersecta com a fonte preparada.
Extrai o alfa desse contexto, executa todos os passes e só então recorta a
saída. Tiles adjacentes equivalem ao raster inteiro dessa mesma fonte.

Não confundir esse contexto com a expansão externa da camada: deslocamento de
sombra, bounds negativos e padding transparente da camada ainda pertencem ao
chamador. Para renderizar fora do conteúdo original, preparar a fonte ampliada
com origem/insets corretos. O kernel não inventa uma expansão documental nem
retorna pixels fora da fonte. Blur deve tratar amostras ausentes como zero em
cada passe, preservando a fronteira finita da referência TS.

## ABI, memória e ciclo de vida

`axia_poc_alpha_mask_region` tem 13 argumentos:

`sourcePtr, sourceLen, sourceW, sourceH, x, y, width, height, outputPtr, outputLen, spread, blur, precise`.

`precise` nativo é 0 ou 1. Adapter e bundle exigem o export/aridade atuais e
rejeitam WASM incompatível antes de preparar fontes. Ponteiros pertencem ao
allocator privado; saída não pode sobrepor fonte. A ABI continua unsafe e
não comprova a validade de ponteiros arbitrários com checks de bounds/overlap.

Limite individual: 64 MiB por buffer externo. Limite de buffers por job:
**96 MiB**, conferido no TS antes da alocação de saída e novamente no Rust:

`sourceBytes + outputBytes + 2 * contextWidth * contextHeight + queueBytes`.

`queueBytes = 4 * max(contextWidth, contextHeight)` se spread > 0; zero nos
demais casos. As máscaras são u8 e a fila usa u32 também em testes nativos.
Rust verifica overflow/reservas, reutiliza as duas máscaras e libera os
temporários por RAII. Saída só é escrita após validação e reservas completas;
rejeição/reserva falha deixa a saída intacta. O adapter libera a saída em erro
e mantém a fonte preparada reutilizável.

O teto conta buffers ativos dessa operação, não overhead do allocator, páginas
WASM retidas, RSS, cópias JS ou outros Workers. Não é orçamento global/LRU.

| Status | Significado |
| --- | --- |
| 0 | Sucesso |
| 1 | Comprimento, geometria ou região inválida |
| 2 | Raios/técnica inválidos |
| 3 | Ponteiro nulo |
| 5 | Saída sobreposta à fonte |
| 6 | Orçamento/reserva interna |

Worker: `alpha-mask-staged-region`, resposta `rendered-staged-region` com
buffer transferido, ID/geração e timings. Mantém gates de fonte/vista/pedido,
invalidação e descarte; cancelamento não interrompe kernel WASM síncrono.
Orçamento/reserva interna usa `memory-limit`; allocator externo mantém
`wasm-failure`. Parâmetros não pertencem à identidade da fonte original,
mas precisam invalidar a vista/resultado filtrado.

## Limites desta fatia

Faltam deslocamento, knockout, cor, contorno, ruído/seed, paint e composição
para sombras/brilhos completos; também faltam traçado circular, demais efeitos,
executor com estágios externos e halo, cache/agendamento e integração normal.
O lote local anterior permanece sem esses filtros. O TS mantém os efeitos
atuais; exportar `spreadAlpha`/`blurAlpha` apenas permite que a suíte compare
com as funções reais, sem copiar sua implementação no oráculo.

Testes, benchmark e restrições estão na [prova Rust/WASM](prova-rust-wasm-c1.md).

Evolução: a [sombra externa](contrato-sombra-externa-v1.md) agora reutiliza os
filtros internos com leitura deslocada e bytes extras no orçamento. A operação
de máscara e sua ABI de 13 argumentos mantêm a semântica anterior.
