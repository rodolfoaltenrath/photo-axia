# Sombra externa regional — ABI experimental V1

Implementada em 2026-10-05. Calcula a contribuição completa de uma sombra
externa sobre um target preparado. Não é composição do documento e não está
ativada no preview/exportação normais.

## Operação

`dropShadowStagedRegion(sourceId, region, target, shadow)` reutiliza a fonte
RGBA8 original preparada com padding. Target/saída são tiles compactos;
fonte/target/pacote não são modificados. A geração da fonte acompanha a resposta.

Ordem: deslocar alfa → expansão quadrada → blur suave → knockout opcional →
contorno → cor/opacidade/ruído → mesclagem com target. Não reaplicar fill ou
opacidade da camada. O caller coloca sombras externas antes do conteúdo.
Sombras repetidas recebem o target anterior e a mesma máscara original.

`prepareRustDropShadow(effect, globalLight, resolutionScale)` resolve ângulo
local/global, tamanho, spread e deslocamento uma vez no TS, com a mesma
trigonometria/arredondamento do caminho atual. Aceita efeito normalizado e
escala finita > 0 até 8. Hash do ID usa FNV-1a sobre **unidades UTF-16**,
incluindo pares substitutos/CJK; Rust recebe somente a seed u32.

Parâmetros resolvidos: raios inteiros não negativos, soma até 4096; offsets
inteiros de -8192 a 8192; RGBA byte; opacidade/ruído finitos 0..100; seis modos
de efeito; knockout booleano; seed u32 e contorno normalizado. Inputs inválidos
não são corrigidos silenciosamente. Limites experimentais não garantem que
qualquer fonte expandida caiba no orçamento.

### Contexto e compatibilidade

Usa o [núcleo da máscara alfa](contrato-mascara-alfa-v1.md) com suporte igual
a spread + blur. Deslocamento é aplicado durante leitura dos pixels originais,
antes dos filtros, com zero fora da fonte global; o corte do contexto não
reinicia o deslocamento. Não produzir uma fonte deslocada inteira intermediária.
Knockout subtrai o alfa **original na posição de saída**, não a máscara deslocada.

Índice do ruído é `y * sourceWidth + x` na grade preparada inteira, nunca
o índice compacto do tile. ID/seed, dimensões e origem/insets pertencem à
identidade dessa grade. Não promete ruído invariável quando o TS atual muda
o padding da composição inteira.

Preserva duas regras atuais, sem corrigi-las nesta migração:

- O último XOR de `randomAt` em JS gera int32 assinado. Há valores negativos,
  que podem aumentar a contribuição; não trocar por PRNG somente positivo.
  Alfa arredondado pode ultrapassar 255 antes da mesclagem. Não limitar esse
  valor antes de `compositePixel`, pois alteraria também o RGB do resultado.
- Contorno customizado usa o primeiro Y também após o último X. Pontos podem
  ser coincidentes e não cobrir 0/1. Preservar ordem/busca/interpolação; não
  extrapolar ou substituir a cauda por último Y.

Contornos: linear, cone, cone invertido, gaussiano, ring e customizado. Ring usa
sin em Rust; paridade medida não é garantia para todo runtime/libm futuro.
Manter testes de limites e revisar ao trocar toolchain/plataforma.

## Pacote binário

Little-endian, header de 64 bytes seguido de pontos customizados (16 bytes
por par f64 X/Y). Comprimento exato, múltiplo de oito, máximo 576 bytes.

| Offset | Tipo | Campo |
| --- | --- | --- |
| 0 / 4 | u32 / u32 | Magic `0x31444853` (`SHD1`) / versão 1 |
| 8 / 12 | u32 / u32 | Spread radius / blur radius |
| 16 / 20 | i32 / i32 | Offset X / Y |
| 24 | u32 | Normal=0, multiply=1, screen=2, overlay=3, darken=4, lighten=5 |
| 28 | u32 | Knockout: 0 ou 1 |
| 32 | quatro u8 | Cor RGBA |
| 36 | u32 | Linear=0, cone=1, inverted-cone=2, gaussian=3, ring=4, custom=5 |
| 40 / 44 | u32 / u32 | Seed / quantidade de pontos |
| 48 / 56 | f64 / f64 | Opacidade / ruído |
| 64 em diante | f64 / f64 | X / Y de cada ponto |

Custom exige 2..32 pontos, X/Y finitos 0..1 e X não decrescente. Demais
contornos exigem count zero no pacote; o encoder omite seus pontos inutilizados.
Quantidades são limitadas antes de calcular comprimentos/reservar memória.

## ABI, orçamento e falhas

`axia_poc_drop_shadow_region` tem 14 argumentos:

`sourcePtr, sourceLen, sourceW, sourceH, x, y, width, height, targetPtr, targetLen, packetPtr, packetLen, outputPtr, outputLen`.

Fonte/target/saída externos até 64 MiB cada; targetLen = outputLen = região RGBA.
Saída não pode sobrepor nenhuma entrada. Adapter/bundle exigem export/aridade.
ABI privada unsafe: usar pares vivos do allocator, não ponteiros de arquivos/mods.

Orçamento de **96 MiB por job**, validado no TS antes das alocações WASM e no
Rust antes das máscaras/fila:

`sourceBytes + targetBytes + packetBytes + outputBytes + 2 * contextPixels + queueBytes + 512`.

Fila u32: quatro bytes por maior eixo do contexto se spread > 0. Reserva
512 cobre dados de até 32 pontos customizados. Não é RSS, pico medido, overhead
do allocator ou orçamento agregado de Workers/caches. Validação e reservas
ocorrem antes de escrever a saída; rejeição não deixa contribuição parcial.
Scratch/contorno usam RAII; adapter libera target/pacote/saída também em erro.
Fonte preparada fica reutilizável até invalidar/liberar/dispose.

Status: 0 sucesso; 1 geometria/comprimento; 2 versão/configuração/contorno;
3 null; 5 overlap; 6 orçamento/reserva interna. Adapter/Worker mantêm
`invalid-input`, `wasm-unavailable`, `wasm-failure` e `memory-limit` estruturados.

Worker: `drop-shadow-staged-region`, target transferível e resposta
`rendered-staged-region`. Fonte/vista/pedido/gate seguem obrigatórios. Alterar
parâmetros invalida o resultado, não exige reupload da mesma máscara. Cancelar
não interrompe o kernel síncrono em andamento.

## Pendências

Preparação da fonte expandida e seus offsets ainda pertence ao chamador. Não
há inserção no lote local nem executor externo completo, composição de conteúdo,
cache/LRU, orçamento global, transformação ou ligação ao renderizador normal.
Outros efeitos permanecem pendentes. Testes e medições na
[prova Rust/WASM](prova-rust-wasm-c1.md).

A sombra interna compartilha os filtros/contornos/mesclagem, mas tem entry point
e pacote SHI1 próprios. SHD1 e seus campos continuam inalterados; os comandos
não aceitam o pacote do outro tipo. Ver [contrato interno](contrato-sombra-interna-v1.md).
