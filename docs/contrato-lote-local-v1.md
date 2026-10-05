# Lote local de estilos — ABI experimental V1

Implementado em 2026-10-05. Complementa o [contrato do compositor](contrato-compositor-v1.md),
sem substituir a pilha, transformações, exportação ou preview normal.

## Operação

`localBatchStagedRegion(sourceId, region, plan)` reutiliza a máscara original,
executa fill → overlays em ordem → Mesclar se — Esta camada opcional e devolve
tile RGBA8 compacto, com a mesma geração da fonte.

- Fill finito de 0 a 100, inclusive frações. Comandos individuais antigos
  continuam aceitando somente fill inteiro.
- Até 64 overlays: cor, gradiente (cinco tipos) e padrão decodificado. Não
  normalizar, ordenar ou excluir silenciosamente um passe inválido.
- Coordenadas da fonte completa; overlays consultam sempre o alfa original;
  o filtro terminal lê os pixels já estilizados.
- Cada passe materializa RGBA8 antes do próximo. Não fundir arredondamentos.
- Camada abaixo permanece fora, pois depende de backdrop e da transformação
  documental. Também faltam efeitos com halo, entrada estilizada por passes
  anteriores, pilha, cache e integração visual.

Worker: comando `local-batch-staged-region` com `plan`. Texturas `Uint8Array`
podem ter seus buffers transferidos dentro da estrutura do plano; não existe
destino intermediário transferido. Resposta: `rendered-staged-region`. Gate
de fonte/vista/pedido continua obrigatório. Cancelamento não interrompe WASM síncrono.

## Pacote binário

Little-endian, comprimento múltiplo de oito: cabeçalho de 32 bytes, `count`
registros de 96 bytes, payloads. Offsets relativos ao pacote, não ponteiros WASM.

| Offset do cabeçalho | Formato | Campo |
| --- | --- | --- |
| 0 | u32 | Magic `0x31425841` (`AXB1`) |
| 4 | u32 | Versão 1 |
| 8 | u32 | Overlays: 0 a 64 |
| 12 | quatro u8 | Shadows start/end, highlights start/end |
| 16 | f64 | Fill opacity |
| 24 | u32 | Filtro terminal: 0 ou 1 |
| 28 | u32 | Canal: cinza=0, vermelho=1, verde=2, azul=3 |

Filtro desabilitado exige marcadores/canal zero. Habilitado exige marcadores
não decrescentes.

| Offset do registro | Formato | Campo |
| --- | --- | --- |
| 0 | u32 | Cor=1, gradiente=2, padrão=3 |
| 4 | u32 | Normal=0, multiply=1, screen=2, overlay=3, darken=4, lighten=5 |
| 8 | f64 | Opacidade: 0 a 100 |
| 16 | f64 | Ângulo em radianos do gradiente; zero nos demais |
| 24 / 32 | f64 / f64 | Cosseno/seno do gradiente ou padrão |
| 40 | f64 | Escala percentual do gradiente ou fator do padrão |
| 48 | u32 | Reverse do gradiente: 0 ou 1 |
| 52 | quatro u8 | RGBA da cor |
| 56 / 60 | u32 / u32 | Offset/comprimento de paradas de cor ou textura |
| 64 / 68 | u32 / u32 | Offset/comprimento de paradas de opacidade |
| 72 | u32 | Tipo do gradiente ou largura da textura |
| 76 | u32 | Altura da textura |
| 80 a 95 | bytes | Reservados zero |

Campos não utilizados pelo tipo devem ser zero. Gradiente: linear=0,
refletido=1, diamante=2, radial=3, angular=4; duas listas de 2 a 32 paradas
em registros de 16 bytes da [prova Rust/WASM](prova-rust-wasm-c1.md). Padrão:
RGBA8, dimensões positivas até 8192 por eixo, comprimento `width * height * 4`.

Payloads começam após os registros, em offset múltiplo de oito, dentro do
pacote. Encoder preenche padding zero. Parser permite payloads compartilhados
entre entradas somente leitura; encoder atual duplica cada ocorrência do
padrão. Não há cache/deduplicação de assets.

## Memória, execução e falhas

`axia_poc_local_batch_region`: 12 argumentos — fonte ponteiro/comprimento/
dimensões, região x/y/width/height, pacote ponteiro/comprimento, saída
ponteiro/comprimento. Adapter/bundle exigem essa aridade; binário sem o export
é rejeitado antes de usar fontes.

Validar todos os efeitos/payloads antes de renderizar; reservar temporários
com `try_reserve_exact`; executar em um ou dois buffers internos reutilizados;
copiar à saída somente após sucesso. Fonte/pacote são somente leitura. Falha
não publica saída parcial. Rust libera scratch e o adapter libera pacote/saída;
a fonte preparada permanece reutilizável até invalidar/liberar.

Limite individual: 64 MiB por buffer externo. Orçamento do lote: **96 MiB**,
verificado no TS antes do pacote final e novamente em Rust:

`sourceBytes + packetBytes + tileBytes * (1 + temporaryCount) + count * 2048`.

Temporários: 1 para fill sozinho, 2 se há overlay/filtro. O tile adicional é
a saída externa; 2048 bytes/efeito reservam conservadoramente metadados/paradas.
Overflow é verificado antes de alocar. Esse limite cobra buffers do job, não
RSS, páginas retidas de WASM, cópias JS, outros Workers/caches ou orçamento
global do editor. O lote reduz cópias JS/WASM mas acrescenta scratch Rust;
não afirmar redução universal do pico de memória.

| Status | Significado |
| --- | --- |
| 0 | Sucesso |
| 1 | Geometria/comprimento/offset inválido |
| 2 | Versão, tipo, configuração ou campo reservado inválido |
| 3 | Ponteiro nulo |
| 5 | Saída sobreposta à fonte/pacote |
| 6 | Orçamento excedido ou reserva interna falhou |

Adapter/Worker usam `memory-limit` para orçamento/reserva interna. Falha do
allocator externo continua `wasm-failure`. Ponteiros devem ser pares vivos
do allocator privado. Bounds/overlap não validam ponteiros arbitrários;
handles seguros seguem pendentes. Não expor diretamente a arquivos/mods.
