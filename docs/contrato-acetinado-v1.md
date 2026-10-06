# Acetinado regional V1 — experimental

Estado: passe CPU Rust/WASM sobre fonte e target preparados. Não é ABI pública
nem executor do documento. Preview normal, exportação, texto e `.axia` não mudam.
Complementa a [máscara alfa](contrato-mascara-alfa-v1.md), as
[sombras](contrato-sombra-interna-v1.md) e os [brilhos](contrato-brilhos-v1.md).

## Fronteira e ordem

- Fonte RGBA8 original na grade completa; região inteira dentro dos limites.
  Padding/insets/origem, quando necessários por outros efeitos, devem estar
  preparados antes do upload. Acetinado não expande os limites por si só.
- Target RGBA8 compacto da região com a composição acumulada; máscara sempre
  vem da fonte, não do alfa já estilizado nem do conteúdo com Fill reduzido.
- Efeito normalizado: size 0..250, distance 0..1000, angle [-180, 180), escala
  finita (0, 8], cor hex RGB/RGBA, opacidade 0..100, invert booleano.
- TS resolve trigonometria/arredondamento uma vez; Rust filtra máscaras,
  calcula a diferença, aplica contorno, recorte e mesclagem dos pixels.

Ordem existente: externo → conteúdo/Fill → interno → overlays → superiores
→ Mesclar se. Acetinado pertence ao estágio interno, antes dos overlays.
Este comando não implementa conteúdo, executor de estágios/lote ou preparação.

## Máscaras, diferença e recorte

`radius = Math.round(size * resolutionScale)`;
`distanceScaled = distance * resolutionScale`;
`radians = angle * Math.PI / 180`;
`dx = Math.round(Math.cos(radians) * distanceScaled)`;
`dy = Math.round(-Math.sin(radians) * distanceScaled)`.

Deslocamentos da segunda máscara são **-dx/-dy depois do arredondamento**.
Não arredondar novamente a direção oposta: Math.round(-0.5) produz -0 enquanto
o espelho de Math.round(0.5) é -1. O pacote transporta apenas dx/dy resolvidos.

Cada máscara deslocada é recortada na grade completa da fonte **antes** do
desfoque. Samples fora dessa grade são zero. Depois aplicar o blur softer
existente: três boxes nos raios floor(r/3), floor((r+1)/3), ceil(r/3), cada
um horizontal/vertical, com divisor fixo e arredondamento u8 por eixo.

Contexto = região ampliada pelo raio e recortada nos limites da fonte. Mesmo
quando o deslocamento excede o halo, samples são lidos nas coordenadas globais
da fonte; não precisam estar dentro do retângulo do contexto. Calcular ambos
os desfoques nesse contexto, então recortar o resultado. Não desfocar só o tile.

Para cada pixel com `mask = originalAlpha/255 > 0`:

```text
diff = (blurPositive - blurNegative) / 255
raw = clamp(invert ? -diff : diff, 0, 1)
contoured = min(mask, contour(raw))
alpha = Math.round(255 * contoured * colorAlpha * opacity/100 * mask)
```

Diferença mantém o sinal; **não usar abs**. Ao contrário dos brilhos e da
sombra interna, raw zero não é descartado antes do contorno. Contorno positivo
em zero pode pintar com distância/raio zero ou duas máscaras iguais. Não
introduzir um no-op para esses casos. O alfa original participa duas vezes:
no min e na multiplicação final, como na referência TS atual.

Contornos: linear, cone, inverted-cone, gaussian, ring, custom. Custom tem
2..32 pontos x/y finitos 0..1, x não decrescente, duplicatas permitidas, sem
obrigar cobertura de 0 e 1. Preserva a cauda/interpolação legada, compartilhada
com as sombras/brilhos. Não usa LUT aproximada.

Seis modos: normal, multiply, screen, overlay, darken, lighten. Mantém ordem
das operações f64 e arredondamento na mesclagem. Máscara zero ou contribuição
zero conserva os bytes do target, incluindo RGB oculto. Acetinado não tem
ruído/seed nem depende de id para seus pixels; id continua no efeito editorial.

## Pacote SAT1

Little-endian, versão 1. Cabeçalho 64 bytes, seguido de registros de contorno
com dois f64 (x/y) por ponto. Comprimento exato `64 + pointCount * 16`, máximo
576 bytes. Counts são limitados antes de multiplicar/reservar.

| Offset | Campo |
| --- | --- |
| 0 / 4 | Magic u32 0x31544153 (`SAT1`) / versão u32 = 1 |
| 8 / 12 | Raio u32 0..4096 / invert u32 0 ou 1 |
| 16 / 20 | dx / dy i32, cada um -8192..8192 |
| 24 | Blend u32 0..5, ordem dos modos acima |
| 28 | Reservado u32 zero |
| 32 | Cor RGBA, quatro u8 |
| 36 | Contorno u32 0..5, ordem dos presets acima |
| 40 / 44 | Reservado u32 zero / pointCount u32 |
| 48 | Opacidade f64 finita 0..100 |
| 56..63 | Oito bytes reservados zero |

Preset integrado exige pointCount zero; custom exige 2..32. Não aceitar um
pacote SHD1/SHI1 como acetinado só porque sua estrutura se parece com SAT1.
Encoder TS reaproveita a validação dos campos comuns da sombra, mas altera
magic/raio/invert e mantém reservados zero. Runtime/bundle exigem export próprio.

## ABI, orçamento e publicação

`axia_poc_satin_region` tem 14 argumentos:

`sourcePtr, sourceLen, sourceW, sourceH, x, y, width, height, targetPtr, targetLen, packetPtr, packetLen, outputPtr, outputLen`.

Fonte/target/saída até 64 MiB cada; target/saída correspondem à região compacta.
Saída não sobrepõe entradas. ABI privada unsafe: apenas pares vivos do allocator,
nunca ponteiros fornecidos por arquivos/mods. Código Rust público por slices
valida buffers/configuração antes de publicar pixels.

Orçamento por job, até 96 MiB, verificado no adapter antes das alocações WASM
e no Rust antes de reservar os filtros:

`sourceBytes + targetBytes + packetBytes + outputBytes + 3 * contextPixels + 512`.

**São três máscaras**, não duas: a primeira filtrada fica retida enquanto o
segundo filtro reserva atual/scratch. Não há fila de spread. Reserva 512 cobre
os pontos. É contabilidade de buffers do job, não RSS/pico medido, overhead do
allocator, cache agregado ou LRU. TS e Rust compartilham a mesma regra; teste
limítrofe cabe com duas máscaras e é corretamente recusado com três.

Reservas dos dois filtros precedem escrita da saída. Falha não publica raster
parcial; RAII/finally liberam temporários e preservam a fonte reutilizável.
Status: 0 sucesso, 1 geometria/comprimento/count, 2 configuração/versão/pontos,
3 null, 5 overlap, 6 orçamento/reserva interna. Adapter/Worker usam os códigos
existentes invalid-input, wasm-unavailable, wasm-failure, memory-limit.

Comando `satin-staged-region`, target transferível, resposta
`rendered-staged-region`. Generation/sourceId, revisão de vista/efeito e pedido
atual continuam necessários para publicar. Mudar parâmetros não exige upload
da mesma fonte. Cancelamento descarta pedidos pendentes, não interrompe kernel
síncrono já em execução. Dispose/invalidate seguem as barreiras existentes.

## Aceite desta fatia

Golden `satin-inverted` já versionado, oráculo TS real, seis modos/contornos,
inversão, todos os pares de alfa, tiles/halos e geometrias finas, escalas,
contorno positivo em zero, RGB oculto, composição antes do overlay com Fill
zero, falhas de ABI/allocator e worker real. Verificações e medições na
[prova C1](prova-rust-wasm-c1.md).

Traçado possui agora um [passe separado](contrato-tracado-v1.md).
Ainda faltam bisel, composição de conteúdo/executor de estágios,
preparação/insets integrada, transformação, cache/orçamento global e validação
end-to-end/multiplataforma. C0/C1/C2 não são encerrados por este passe isolado.
