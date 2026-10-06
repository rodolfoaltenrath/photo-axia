# Bisel/relevo regional V1 — experimental

Estado: passe CPU Rust/WASM sobre fonte/target preparados. Não é ABI pública
nem compositor do documento. Preview normal, exportação, texto e `.axia`
permanecem inalterados. Complementa o [contrato lógico](contrato-compositor-v1.md).

## Grade, máscara e altura

Fonte RGBA8 original na grade completa; padding/insets já preparados pelo
chamador. Target compacto da região contém a composição acumulada. Região
inteira dentro da fonte; saída compacta, sem sobreposição com entradas.
Nunca usar o alfa do target como máscara original.

O efeito normalizado usa size/soften 0..250, depth 1..1000, altitude 0..90,
opacidades 0..100 e escala finita (0,8]. TS resolve:

```text
R = max(1, Math.round(size * resolutionScale))
S = Math.round(soften * resolutionScale)
strength = depth / 100 * 4
```

Smooth filtra alfa com três boxes cujos raios somam R; chisel-hard e
chisel-soft usam um box preciso de raio R. Softening aplica três boxes de
suporte total S, depois do primeiro filtro. Cada eixo arredonda para u8,
mantendo zeros fora da fonte e o divisor completo da janela.

Chisel-hard transforma a rampa **após** softening:
`round(clamp((height/255 - 0.5)*2 + 0.5)*255)`. Chisel-soft não aplica esse
contraste extra. Não trocar esses passos por uma fórmula aproximada.

Contexto = região ampliada por **R + S + 1**, recortada nos limites completos
da fonte. O pixel extra cobre as diferenças centrais de iluminação. Filtrar
todo o contexto; recortar só a saída. Vizinho de iluminação fora da grade
completa é clamped à borda verdadeira da fonte, não à borda do tile.

## Textura e iluminação

Textura ativa é RGBA8 decodificado, cada eixo 1..8192, até 64 MiB e tamanho
exato. Amostra nearest por coordenadas globais, ângulo zero/escala do efeito,
duplo resto e floor. Compartilha `sample_pattern` com os demais passes.
Não renormalizar origem por tile.

```text
luminance = (R + G + B) / 3 / 255
delta = (luminance - 0.5) * 2 * (textureDepth/100) * (invert ? -1 : 1)
height = round(clamp(height/255 + delta) * 255)
```

O **alfa da textura é ignorado**, como no TS atual. `textureLinkWithLayer`
continua no efeito editorial, mas o passe atual não o consulta. Sem asset
configurado, continua sem textura mesmo com textureEnabled; asset configurado
sem decode é invalid-input no adapter, nunca no-op silencioso. Textura
desabilitada é ignorada. Decode, origem e padding não são responsabilidade
deste passe. A textura é copiada no pacote por pedido; cache ainda pendente.

TS calcula vetor de luz para preservar trigonometria nas fronteiras:

```text
angle = useGlobalLight ? globalLight.angle : effect.angle
altitude = effect.altitude
L = [cos(angle)*cos(altitude), -sin(angle)*cos(altitude), sin(altitude)]
dx = (rightHeight-leftHeight)/2 * strength * directionSign * styleSign
dy = (bottomHeight-topHeight)/2 * strength * directionSign * styleSign
N = [-dx, -dy, 1]
dot = (N.x*L.x + N.y*L.y + L.z) / sqrt(N.x² + N.y² + 1)
```

Ângulos em radianos após conversão, angle [-180,180). **Altitude global não
substitui altitude do efeito** na referência atual. Down inverte direção;
pillow-emboss inverte styleSign. Os demais estilos mantêm styleSign positivo.

Peso de inner-bevel = alfa original/255; outer-bevel = 1-alfa original/255;
emboss/pillow = 1. Não descartar alfa original zero para os últimos três.
Dot exatamente zero não contribui, mesmo com glossContour positivo em zero.

Intensity = glossContour(clamp(abs(dot))); se contourEnabled, aplicar
contour(clamp(intensity*100/contourRange)). ContourRange 1..100. Seis presets,
custom 2..32 pontos f64 ordenados, duplicatas/endpoints ausentes e cauda legada
preservados. Dot positivo usa highlight, negativo usa shadow, com suas cores,
opacidades e modos independentes; blendMode base não é usado por este passe.
Alpha arredonda antes de compor. Contribuição zero conserva RGB oculto/target.

Bisel pertence ao estágio **superior, após overlays**; ordem entre bisel e
traçado segue a ordem desses efeitos no estágio. Fill não altera a máscara.

## Pacote BEV1

Little-endian, versão 1, cabeçalho 160 bytes. Body: pontos de glossContour,
pontos de contour e RGBA bruto da textura, nessa ordem. Ponto = x f64 + y f64,
16 bytes. Não exigir alinhamento extra depois de uma textura RGBA de um pixel.

| Offset | Campo |
| --- | --- |
| 0 / 4 | Magic u32 0x31564542 (`BEV1`) / versão u32 = 1 |
| 8 / 12 | R / S u32, R >= 1, ambos <=4096, soma <=4096 |
| 16 | Técnica u32: smooth/chisel-hard/chisel-soft = 0..2 |
| 20 | Estilo u32: inner-bevel/outer-bevel/emboss/pillow-emboss = 0..3 |
| 24 / 28 | Down / contourEnabled u32 0 ou 1 |
| 32 / 36 | Highlight / shadow blend u32, seis modos = 0..5 |
| 40 / 44 | Highlight / shadow RGBA, quatro u8 cada |
| 48 / 52 | Gloss preset u32 0..5 / pointCount u32 |
| 56 / 60 | Contour preset u32 0..5 / pointCount u32 |
| 64 / 68 / 72 | TextureWidth / textureHeight / textureLength u32 |
| 76 | TextureInvert u32 0 ou 1 |
| 80 | Opacidade f64 0..100 |
| 88 | Strength f64 0.04..40 |
| 96 / 104 / 112 | Light X / Y / Z f64, vetor unitário tolerância 1e-12, Z >= 0 |
| 120 / 128 | HighlightOpacity / shadowOpacity f64 0..100 |
| 136 | ContourRange f64 1..100 |
| 144 | TextureScaleFactor f64 0.01..10 |
| 152 | TextureDepthFactor f64 -10..10, inversão ainda não aplicada |

Valores f64 finitos; ponto x/y em [0,1]. Preset não custom exige count zero;
custom exige 2..32. Counts limitados antes da aritmética; comprimento exato
`160 + 16*(glossCount+contourCount) + textureLength`, pacote até 64 MiB.
Sem textura: width/height/length/invert zero, scaleFactor 1, depthFactor 0.
Validar também o contorno opcional quando desabilitado. Nunca aceitar SAT1/STK1.

## ABI, memória e lifecycle

`axia_poc_bevel_region` tem 14 argumentos:

`sourcePtr, sourceLen, sourceW, sourceH, x, y, width, height, targetPtr, targetLen, packetPtr, packetLen, outputPtr, outputLen`.

ABI privada unsafe: somente pares vivos do allocator, não ponteiros de mods
ou arquivos. Fonte/target/saída até 64 MiB cada. Validação e reservas antecedem
a escrita da saída. Status: 0 sucesso; 1 geometria/comprimento/count;
2 configuração/contorno/textura; 3 null; 5 overlap; 6 orçamento/reserva interna.

Orçamento conservador por job até 96 MiB:

```text
sourceBytes + targetBytes + outputBytes + packetBytes + 1024
+ 2 * contextPixels
```

Dois buffers u8 reutilizados entre filtros; contraste/textura modificam a rampa
in-place. Até 64 pontos usam reserva de 1024 bytes. Sem alocação por pixel.
TS verifica orçamento **antes de materializar/copiar o pacote de textura ou
alocar no WASM**; Rust verifica antes das reservas dos filtros. Não é RSS,
LRU/cache nem limite agregado de pedidos.

Worker `bevel-staged-region` recebe target e textura transferível, retorna
rendered-staged-region. Fonte staged original reutilizável; generation,
sourceId, revisão de vista/efeito e ID atual condicionam publicação. RAII/finally
liberam temporários. Cancel não interrompe kernel síncrono já ativo.

## Aceite e próximos passos

Golden original, matriz de técnicas/estilos/direções/contornos/seis modos,
pares de alfa, texturas/escala/inversão, tiles/halos, raios máximos, contornos
estreitos, máscaras esparsas, combinação com Fill zero, falhas e worker real.
Medições e verificações na [prova C1](prova-rust-wasm-c1.md).

Os dez tipos atuais também têm [executor de estágios](contrato-estagios-v1.md)
sobre fonte preparada. Faltam preparação/insets integrada, transformações, cache/orçamento global
e validação end-to-end/multiplataforma. C0/C1/C2 continuam abertos; não é
rollout no editor normal nem conclusão da migração.
