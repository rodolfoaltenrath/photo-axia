# Sombra interna regional V1 — experimental

Estado: passe CPU Rust/WASM isolado. Não é ABI pública nem compositor do
documento. Preview normal, exportação, texto e `.axia` permanecem inalterados.
Complementa a [sombra externa](contrato-sombra-externa-v1.md), reutilizando seus
filtros, contornos, ruído e mesclagem sem alterar o pacote SHD1 existente.

## Entradas e ordem

- Fonte RGBA8 original preparada na grade completa, com os insets de todos
  os efeitos quando aplicáveis. O chamador prepara fonte, origem e resolução.
- Região inteira dentro dessa grade; target RGBA8 compacto da mesma região.
  O target contém a composição acumulada; não substitui a máscara original.
- Efeito normalizado: tamanho/distância em pixels da camada, escala até 8,
  luz local/global, cor RGB/RGBA hexadecimal, contração (`choke`), opacidade,
  contorno, ruído e um dos seis modos de mesclagem existentes.

O estágio atual do compositor é: efeitos externos → conteúdo/Fill → efeitos
internos → overlays → efeitos superiores → Mesclar se. Este comando executa
uma sombra interna, não decide nem executa os outros estágios. Não inseri-lo
depois de um overlay por conveniência do scheduler.

## Geometria e cálculo

O TS resolve trigonometria, arredondamento e seed uma vez por efeito:

`r = Math.round(size * scale)`

`distanceScaled = distance * scale`

`dx = Math.round(cos(angle) * distanceScaled)`

`dy = Math.round(-sin(angle) * distanceScaled)`

A direção difere da externa **antes** do arredondamento. Negar o deslocamento
inteiro da externa falha em meio pixel: `Math.round(-0.5)` é zero enquanto
`Math.round(0.5)` é um. O seed usa FNV-1a sobre unidades UTF-16 do ID, incluindo
surrogates; não converter para UTF-8.

O Rust desloca a máscara, tratando fora da fonte como zero, antes do desfoque.
Usa três passes box com raios `floor(r/3)`, `floor((r+1)/3)`, `ceil(r/3)`;
cada eixo materializa o resultado arredondado em u8. Não há spread nem modo
precise neste efeito. Contexto = região ampliada por `r`, recortada nos limites
da fonte preparada. O deslocamento é aplicado durante a leitura desse contexto;
halo não significa desfoque independente do tile.

Para cada pixel, com `mask = originalAlpha/255` e `blurred = filteredAlpha/255`:

1. Ignorar `mask <= 0`, preservando RGB oculto do target.
2. `raw = mask * clamp((1 - blurred) * 2, 0, 1)`; ignorar `raw <= 0` antes do
   contorno, mesmo que um contorno customizado tenha valor positivo em zero.
3. `choked = clamp(raw / max(0.01, 1 - min(0.99, choke/100)), 0, 1)`.
4. `contoured = min(mask, contour(choked))`. Contração 99 e 100 compartilham
   esse teto conforme o algoritmo atual, sem normalização nova.
5. Aplicar alfa de cor, opacidade e ruído e arredondar o alfa da contribuição;
   compor normal/multiply/screen/overlay/darken/lighten sobre o target.

Contornos, cauda customizada legada, PRNG com XOR final assinado e índice global
`y * sourceWidth + x` são os da referência TS. Ruído pode aumentar o alfa;
não saturar em u8 antes da mesclagem nem reafirmar o teto da máscara depois
do ruído. Alterar tais regras é mudança visual separada do porte.

## Pacote SHI1

Little-endian, versão 1, cabeçalho de 72 bytes. Mantém o layout SHD1 até byte
63; adiciona `choke:f64` em 64; os pontos começam em 72. Comprimento exato
`72 + 16 * pointCount`, máximo 584 bytes.

| Offset | Campo |
| --- | --- |
| 0 | Magic u32 `0x31494853` (`SHI1`) |
| 4 | Versão u32 = 1 |
| 8 | Spread u32 = 0, reservado |
| 12 | Blur u32, 0..4096 |
| 16 / 20 | Offset X/Y i32, -8192..8192 |
| 24 | Mesclagem u32, 0..5, mesma ordem da externa |
| 28 | Knockout u32 = 0, reservado |
| 32 | Cor RGBA, quatro u8 |
| 36 | Contorno u32: linear/cone/inverted-cone/gaussian/ring/custom = 0..5 |
| 40 / 44 | Seed u32 / quantidade de pontos u32 |
| 48 / 56 / 64 | Opacidade / ruído / contração f64, finitos 0..100 |
| 72+ | Pares x/y f64 de pontos customizados |

Custom exige 2..32 pontos, x/y finitos em 0..1 e x não decrescente; x duplicado
é permitido. Presets integrados exigem zero pontos. Quantidade é limitada antes
da multiplicação/reserva. Campos reservados não zero são rejeitados.

Os entry points de sombras rejeitam o pacote do outro tipo. Isso evita
reinterpretar contração como spread/knockout ou ler pontos no offset errado.

## ABI e orçamento

`axia_poc_inner_shadow_region` tem 14 argumentos, na ordem da sombra externa:

`sourcePtr, sourceLen, sourceW, sourceH, x, y, width, height, targetPtr, targetLen, packetPtr, packetLen, outputPtr, outputLen`.

Fonte/target/saída até 64 MiB cada; target e saída correspondem à região.
Saída não sobrepõe nenhuma entrada. ABI privada unsafe: ponteiros só dos pares
vivos do allocator, não de arquivos ou mods. Adapter e bundle exigem aridade.

Orçamento de 96 MiB por job:

`sourceBytes + targetBytes + packetBytes + outputBytes + 2 * contextPixels + 512`.

Não existe fila de spread. Reserva 512 cobre os pontos customizados; não é
RSS, overhead do allocator, orçamento agregado nem LRU. TS valida antes de
alocar target/pacote/saída WASM; Rust reserva scratch antes de publicar pixels.
Falhas preservam a saída. RAII e `finally` liberam temporários; a fonte fica
reutilizável até invalidar/liberar/dispose.

Status: 0 sucesso; 1 geometria/comprimento; 2 configuração/versão/contorno/tipo;
3 null; 5 overlap; 6 orçamento/reserva interna. Worker mantém códigos
`invalid-input`, `wasm-unavailable`, `wasm-failure`, `memory-limit`.

Comando `inner-shadow-staged-region`, target transferível, resposta
`rendered-staged-region`. Fonte/vista/pedido/gate seguem obrigatórios. Alterar
parâmetros invalida o resultado, sem reupload da mesma máscara. Cancelar não
interrompe um kernel síncrono que já começou.

## Validação e pendências

Golden existente `inner-shadow-edge`, referência TS exportada sem modificar
aritmética, matrizes de alfas/contornos/ruído/contração/mesclagem, tiles nas
bordas, cadeia externa/interna/overlay com Fill zero e falhas de ABI/allocator.
Sonda Node e diagnóstico WebView2 descritos na [prova](prova-rust-wasm-c1.md).

Faltam demais efeitos, conteúdo/estágios no lote, fonte/insets integrados,
transformação/reamostragem, cache e orçamento agregado, scheduler end-to-end
e validação multiplataforma. C0/C1/C2 permanecem abertos.
