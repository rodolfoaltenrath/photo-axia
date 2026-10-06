# Traçado regional V1 — experimental

Estado: passe CPU Rust/WASM sobre fonte/target preparados. Não é ABI pública
nem compositor do documento. Preview normal, exportação, texto e `.axia`
permanecem inalterados. Complementa o [contrato lógico](contrato-compositor-v1.md).

## Fonte, posição e máscara

Fonte RGBA8 original na grade completa, com padding/insets já preparados pelo
chamador quando há efeitos externos. Target RGBA8 compacto da região contém
a composição acumulada. Não usar o alfa do target como máscara. Região inteira
dentro da fonte; saída compacta e sem sobreposição com entradas.

Efeito normalizado: size 1..250, escala finita (0, 8], opacidade 0..100,
seis modos existentes. `thickness = max(1, Math.round(size * resolutionScale))`.

| Posição | Raio externo | Raio interno |
| --- | --- | --- |
| Outside | thickness | 0 |
| Inside | 0 | thickness |
| Center | ceil(thickness/2) | floor(thickness/2) |

Expansão externa é **circular**, por distância euclidiana quadrada ao pixel
com alfa > 0 mais próximo. Inclui distância <= raio²; resultado binário 0/255.
Não substituir pela dilatação quadrada usada em sombras/brilhos. Alfa mínimo
1 já constitui uma origem. Raio externo zero usa o alfa original diretamente.

Erosão interna preserva o mínimo quadrado/separável legado: horizontal e
vertical, com zeros fora da fonte. Não troca por erosão circular nesta migração.
Raio interno zero usa alfa original. A contribuição é:

```text
mask = max(0, expandedAlpha - erodedAlpha) / 255
alpha = Math.round(255 * mask * paintOpacity * effectOpacity/100)
```

Sem contribuição, conserva target/RGB oculto. Traçado pertence ao estágio
superior, **após overlays**. Ordem de efeito no array não substitui a ordem
dos estágios. Fill não altera a máscara original.

## Distâncias, contexto e limites

Contexto = região ampliada por max(raio externo, raio interno), recortada nos
limites completos da fonte. Calcular os dois eixos nesse contexto e recortar
só depois. Assim tiles não ganham cantos/bordas falsos. Erosão introduz zeros
no limite do contexto, mas o halo mantém esse limite fora das amostras válidas
do tile, exceto quando coincide com a borda real da fonte.

Transformada quadrada 1D por envoltória de parábolas, duas passagens, mantendo
comparações e fronteiras f64 da referência TS. Sites/entrada/saída i32/u32;
distâncias i32 por contexto. Sentinel é **sourceWidth² + sourceHeight² + 1**,
não dimensões do tile/contexto. Isso também preserva a particularidade legada
de máscara vazia em uma grade pequena sem padding quando raio² >= sentinel.
Não corrigir essa particularidade apenas no Rust; uma mudança futura exige
ajustar o contrato TS e seus goldens deliberadamente.

Com raio externo positivo, exigir sourceWidth² + sourceHeight² + 1 <=
2.147.483.647; rejeitar antes de filtrar se a referência Int32 perderia essa
representação. Buffer de 64 MiB sozinho não impede uma grade extremamente
fina/larga de exceder o limite. Erosão interna e padrão ausente não precisam
desse limite de distância. Não saturar ou usar um sentinel diferente em silêncio.

## Pintura e amostragem

- Cor sólida RGBA8, alfa de cor independente da opacidade do efeito.
- Degradê espacial: linear/reflected/diamond/radial/angle, 2..32 paradas de
  cor e 2..32 de opacidade, posição f64 ordenada, duplicatas permitidas e sem
  obrigar endpoints. Angle [-180,180), scale 1..1000 e reverse. Usa centro de
  pixel global e dimensões completas da fonte preparada, **não do tile**.
- Padrão RGBA8 decodificado: cada eixo 1..8192, até 64 MiB, dimensões e tamanho
  exatos. Rotação negativa, scaleFactor = max(0.01, scale/100), repetição com
  duplo resto e floor nas coordenadas globais. Sem interpolação adicional.

TS resolve sin/cos/ângulo radiano uma vez. Rust compartilha position e
sample_gradient com overlays, incluindo Math.hypot compatível, arredondamento
RGB/f64 e extrapolações legadas. Pattern reutiliza sample_pattern, extraído sem
alterar a matemática do overlay. Valores intermediários não são saturados
antes do compositor de pixels. Não usar uma LUT aproximada para paradas estreitas.

alignWithLayer/linkWithLayer continuam no efeito editorial; o passe atual não
consulta esses flags, como o TS. Sem asset de padrão configurado, no-op explícito.
Com asset configurado mas não decodificado, adapter rejeita invalid-input;
referência TS acusa LayerStylePatternMissingError. Nunca tratar falha de decode
como no-op silencioso. Este passe não faz decode nem prepara padding/origem.

## Pacote STK1

Little-endian, versão 1, cabeçalho 96 bytes. Payload de gradiente: cores e
opacidades, nessa ordem, cada registro 16 bytes. Cor = posição f64, RGBA u8,
quatro bytes finais zero. Opacidade = posição f64 + percentual f64. Payload
de padrão = RGBA bruto, sem padding extra. Pacote inteiro até 64 MiB.

| Offset | Campo |
| --- | --- |
| 0 / 4 | Magic u32 0x314b5453 (`STK1`) / versão u32 = 1 |
| 8 / 12 | Raio externo / interno u32, 0..4096, soma 1..4096 |
| 16 | Paint u32: cor 0, gradiente 1, padrão 2, padrão ausente 3 |
| 20 | Blend u32: normal/multiply/screen/overlay/darken/lighten = 0..5 |
| 24 | Cor RGBA quatro u8; zero para demais paints |
| 28 | Gradient kind u32: linear/reflected/diamond/radial/angle = 0..4 |
| 32 | Reverse u32 0 ou 1 |
| 36 / 40 | ColorCount / opacityCount u32 |
| 44 / 48 / 52 | PatternWidth / patternHeight / patternLength u32 |
| 56 | Opacidade f64 finita 0..100 |
| 64 / 72 | Cosine / sine f64 finitos, vetor unitário tolerância 1e-12 |
| 80 | Scale f64: gradiente 1..1000; padrão scaleFactor 0.01..10 |
| 88 | Ângulo radiano f64 do gradiente, [-PI,PI) |

Campos de outro paint são zero. Cor/padrão ausente exigem cosine 1, sine 0,
scale 1. Padrão exige radians/kind/reverse zero; gradiente exige geometria de
padrão zero. Counts limitados antes de somar/multiplicar, comprimento exato
`96 + 16*(colorCount+opacityCount) + patternLength`. Nunca aceitar SAT1/GLW1.

## ABI, memória e lifecycle

`axia_poc_stroke_region` tem 14 argumentos:

`sourcePtr, sourceLen, sourceW, sourceH, x, y, width, height, targetPtr, targetLen, packetPtr, packetLen, outputPtr, outputLen`.

ABI privada unsafe: somente pares vivos do allocator, não ponteiros de mods
ou arquivos. Fonte/target/saída até 64 MiB cada. Validações e todas as reservas
precedem a escrita de saída; falhas não publicam pixels parciais. Status:
0 sucesso; 1 geometria/comprimento/count; 2 configuração/pintura/distância;
3 null; 5 overlap; 6 orçamento/reserva interna.

Orçamento por job até 96 MiB, verificado no TS **antes de materializar/copiar
o pacote de textura e alocar no WASM**, e no Rust antes das reservas de filtros:

```text
sourceBytes + targetBytes + outputBytes + packetBytes + 2048
+ 3 * contextPixels
+ [4 * contextPixels + 20 * maxAxis + 8, se raio externo > 0]
+ [4 * (maxAxis + 2 * raioInterno), se raio interno > 0]
```

Três máscaras u8, matriz i32 e buffers de linha/índices/fronteiras da EDT,
fila da erosão com padding e reserva 2048 dos stops. Buffers são reservados
uma vez por job, reutilizados por linha; não há alocação por pixel. Contabilidade
conservadora com buffers simultâneos, não RSS/overhead real, cache/LRU ou
orçamento agregado. Padrão ausente conta só buffers externos e reserva 2048.
Textura está no pacote e é copiada por pedido; cache de assets segue pendente.

Worker `stroke-staged-region` recebe target e pintura (textura transferível),
retorna rendered-staged-region. Fonte staged original reutilizável, generation,
sourceId, revisão de vista/efeito e ID atual continuam obrigatórios para publicar.
RAII/finally liberam temporários. Cancel não interrompe o kernel síncrono em
execução; invalidate/dispose preservam as barreiras existentes.

## Aceite e pendências

Golden combinado existente, matriz das três posições/pinturas e seis modos,
pares de alfa, círculo, tiles/halos, máscaras esparsas/vazias, escalas, 32 stops
estreitos/duplicados, ordem após overlay com Fill zero, falhas e worker real.
Medições e verificações na [prova C1](prova-rust-wasm-c1.md).

O bisel agora tem [passe separado](contrato-bisel-v1.md). Faltam composição
de conteúdo/executor de estágios, preparação/insets
integrada, transformação, cache/orçamento global e validação end-to-end/
multiplataforma. C0/C1/C2 permanecem abertos; não é rollout no editor normal.
