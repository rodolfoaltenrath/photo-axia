# Brilhos regionais V1 — experimental

Estado: brilho externo e interno (borda/centro) CPU Rust/WASM sobre fonte e
target preparados. Não é ABI pública nem executor do documento; não altera
preview normal, exportação, texto ou `.axia`. Complementa a
[máscara alfa](contrato-mascara-alfa-v1.md) e as
[sombras](contrato-sombra-interna-v1.md).

## Fronteira

- Fonte RGBA8 original na grade completa; região inteira dentro dos limites.
  Quando há efeitos externos, preparar padding/insets/origem antes do upload.
- Target RGBA8 compacto da região com a composição acumulada; não usar seu
  alfa como máscara de origem. Máscara permanece a da fonte preparada.
- Efeito normalizado, tamanho 0..250 e escala até 8; TS resolve raio,
  spread, seed FNV-1a sobre UTF-16 e cores hex RGB/RGBA.
- Paint sólido ou degradê com 2..32 paradas de cor e 2..32 de opacidade;
  contorno integrado ou customizado com 2..32 pontos.

Ordem do compositor atual: externo → conteúdo/Fill → interno → overlays →
superiores → Mesclar se. Brilho externo pertence ao primeiro estágio;
brilho interno, ao terceiro. Este passe não implementa os demais estágios,
composição de conteúdo nem a gestão de insets de uma pilha.

## Máscara, halos e intensidade

`radius = Math.round(size * scale)`.

Externo: `spread = min(radius, Math.round(radius * spreadPercent/100))`;
blur = radius - spread. Dilatação quadrada existente, não traçado circular.
Interno: spread = 0, blur = radius. Técnicas: precise = um box horizontal/
vertical no raio; softer = três boxes nos raios floor(r/3), floor((r+1)/3),
ceil(r/3). Divisor fixo, amostras fora da fonte transparentes e arredondamento
u8 após cada eixo conforme o TS.

Contexto = região ampliada por spread + blur e recortada nos limites da
fonte preparada. Filtrar no contexto e só depois recortar o tile; não borrar
somente seu retângulo de saída. O ruído/jitter usa o índice global da grade
`y * sourceWidth + x`, não o índice compacto do tile.

Com mask = originalAlpha/255 e blurred = filteredAlpha/255:

- Externo: raw = max(0, filteredAlpha - originalAlpha)/255.
- Interno borda: raw = mask * clamp((1 - blurred) * 2, 0, 1).
- Interno centro: raw = mask * blurred.

Interno ignora mask <= 0; ambos ignoram raw <= 0 **antes** do contorno.
Interno com raio arredondado zero é no-op, inclusive centro e contorno positivo
em zero. Esses atalhos preservam RGB oculto do target.

Interno aplica contração:

`choked = clamp(raw / max(0.01, 1 - min(0.99, choke/100)), 0, 1)`.

Externo usa raw diretamente. Depois:

`ranged = clamp(choked * 100 / range, 0, 1)`;

`contoured = contour(ranged)`;

`jittered = clamp(contoured + (randomAt(seed, index) - 0.5) * jitter/100, 0, 1)`
quando jitter > 0, senão contoured.

O PRNG mantém o XOR final assinado do TS; pode produzir valor negativo.
Não corrigir essa distribuição durante a migração. Contornos mantêm a cauda
customizada legada. Ruído usa seed XOR 0x9e3779b9 e o mesmo índice global.

Alfa da contribuição: arredondar `255 * jittered * paintOpacity * opacity/100
* noiseFactor`, multiplicando ainda por mask no brilho interno. O recorte
interno não é o `min(mask, contour)` da sombra interna. Ruído pode elevar alfa:
preservar f64 até a mesclagem, sem saturação antecipada. Seis modos existentes:
normal, multiply, screen, overlay, darken e lighten.

## Paint do degradê

O degradê é amostrado pela **intensidade** jittered, ou 1 - jittered quando
invertido. Não usa posição XY, tipo geométrico, ângulo, escala ou alinhamento
do gradiente espacial. Esses dados continuam preservados no efeito do editor;
a ABI transporta somente paradas e reverse, conforme a referência atual.

Interpolação compartilha a rotina Rust dos overlays: posições f64 ordenadas,
duplicatas permitidas, RGB arredondado por canal, alfa de cor interpolado e
paradas de opacidade independentes. Preservar a extrapolação first/last depois
da última parada e as operações fora de 0..255 até o compositor de pixels.
Não gerar uma LUT aproximada: perde os casos com paradas muito próximas.

## Pacote GLW1

Little-endian, versão 1. Cabeçalho 96 bytes; depois, contorno, cores e
opacidades, nessa ordem. Cada registro ocupa 16 bytes. Comprimento exato
`96 + 16 * (pointCount + colorCount + opacityCount)`, máximo 1632 bytes.

| Offset | Campo |
| --- | --- |
| 0 / 4 | Magic u32 0x31574c47 (`GLW1`) / versão u32 = 1 |
| 8 | Kind u32: externo 0, interno borda 1, interno centro 2 |
| 12 / 16 | Spread / blur u32, cada um e sua soma até 4096 |
| 20 | Precise u32 = 0 ou 1 |
| 24 | Blend u32 0..5, ordem dos modos acima |
| 28 | Paint u32: sólido 0, gradiente 1, gradiente invertido 2 |
| 32 | Cor RGBA quatro u8, zero quando paint é gradiente |
| 36 | Contorno u32: linear/cone/inverted-cone/gaussian/ring/custom = 0..5 |
| 40 / 44 / 48 / 52 | Seed / pointCount / colorCount / opacityCount u32 |
| 56 / 64 / 72 / 80 / 88 | Opacidade / ruído / range / jitter / choke f64 |

Opacidade, ruído, jitter e choke finitos 0..100; range finito 1..100.
Externo exige choke zero; interno exige spread zero. Preset integrado exige
pointCount zero, custom exige 2..32; x/y finitos 0..1 e x não decrescente.
Sólido exige zero paradas. Gradiente exige 2..32 paradas de cada tipo:

- Cor: posição f64, RGBA u8 em bytes 8..11, quatro bytes finais reservados zero.
- Opacidade: posição f64, opacidade f64 0..100.

Posições finitas 0..1 e não decrescentes, sem obrigar cobertura de 0 e 1.
Counts são limitados antes de somar/multiplicar ou reservar memória.

## ABI, falhas e lifecycle

`axia_poc_glow_region` tem 14 argumentos:

`sourcePtr, sourceLen, sourceW, sourceH, x, y, width, height, targetPtr, targetLen, packetPtr, packetLen, outputPtr, outputLen`.

Fonte/target/saída até 64 MiB cada; target/saída correspondem à região.
Saída não sobrepõe entradas. ABI privada unsafe: somente pares vivos do allocator,
nunca ponteiros fornecidos por arquivos/mods. Adapter/bundle exigem aridade.

Orçamento de 96 MiB por job, validado no TS antes das alocações WASM e no Rust
antes de reservar máscaras/fila:

`sourceBytes + targetBytes + packetBytes + outputBytes + 2 * contextPixels + queueBytes + 2048`.

Fila = 4 * maior eixo do contexto somente quando spread > 0. Reserva 2048
cobre dados dos pontos e paradas. Não é RSS, overhead do allocator, cache/LRU
nem orçamento agregado. Validações/reservas precedem publicação de pixels;
falhas preservam saída. RAII e finally liberam temporários em ambos os lados.

Status: 0 sucesso; 1 geometria/comprimento/count; 2 configuração/versão/paint;
3 null; 5 overlap; 6 orçamento/reserva interna. Worker conserva os códigos
invalid-input, wasm-unavailable, wasm-failure e memory-limit.

Comando `glow-staged-region`, target transferível, resposta
`rendered-staged-region`. Generation/sourceId, vista e pedido continuam
obrigatórios para publicar. Alterar parâmetros invalida resultado antigo sem
reupload da mesma máscara. Cancelar não interrompe kernel síncrono em andamento.

## Encerramento desta fatia versus migração

Dois goldens existentes, matrizes de parâmetros/alfas, tiles, paradas
estreitas/duplicadas, cadeia externa/interna/overlay e falhas de ABI/allocator.
Medições isoladas e validações estão na [prova](prova-rust-wasm-c1.md).

Acetinado possui agora um [passe separado](contrato-acetinado-v1.md).
Ainda faltam traçado, bisel, composição de conteúdo e executor dos
estágios/lote, preparação/insets integrada, transformação, cache/orçamento
global e validação end-to-end/multiplataforma. Nenhum gate C0/C1/C2 é encerrado.
