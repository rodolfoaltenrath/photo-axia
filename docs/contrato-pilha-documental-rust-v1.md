# Núcleo inicial da pilha documental Rust — C3, fatia 1

Estado da fatia 1: **implementado e testado como função Rust segura**. A fatia 2
adicionou [ABI DCP1/runtime/Worker](contrato-abi-pilha-documental-rust-v1.md),
ainda sem consumidor editorial. A fatia 3 acrescenta
[transformações/grade global e DCP2](contrato-transformacoes-documentais-rust-v1.md).
Não substitui `renderDocument.ts`,
o preview DOM ou o executor de estilos. Relacionado ao
[contrato lógico](contrato-compositor-v1.md) e ao
[roadmap](roadmap-compositor-rust-internacionalizacao.md).

## 1. Interface e alcance atual

`rust/axia-pixel-core/src/document_composite.rs` expõe:

```text
compose_document_region(DocumentCompositeJob, output: &mut [u8]) -> Result

DocumentCompositeJob {
  document_width: u32, document_height: u32,
  region: { x: usize, y: usize, width: usize, height: usize },
  resolution_scale: f64, output_grid: Option<DocumentOutputGrid>,
  layers_bottom_to_top: &[DocumentRasterLayer]
}

DocumentRasterLayer {
  rgba: &[u8], width: usize, height: usize,
  x: i32, y: i32, visible: bool, opacity: f64,
  blend_mode: Normal | Multiply | Screen | Overlay | Darken | Lighten,
  transform: Option<DocumentAffine>
}
```

Fontes RGBA8 com alfa reto, compactas, row-major, stride `width * 4`; saída
compacta com stride `region.width * 4`. Não aceita stride arbitrário nesta
fatia. Os bytes de cor são compostos no domínio normalizado dos canais de
entrada; não há conversão para luz linear nem promessa de ICC/P3.

Documento usa origem `(0, 0)` e bounds semiabertos. Região usa coordenadas
globais não negativas; origem da camada admite posição inteira negativa.
Pixels da região fora do documento são transparentes. Bounds que apenas
tocam não se sobrepõem. Os cálculos de interseção usam `i64`, também no WASM32,
para não somar origem assinada/dimensões em `usize` e provocar wrap.

`resolution_scale` deve ser exatamente `1.0`: zero, escalas fracionárias,
ampliação, NaN e infinito retornam `UnsupportedScale`. Sem `output_grid`,
mantém a translação inteira original. A fatia 3 recebe escala de saída em
`output_grid` e afim em `transform`, sem arredondar coordenadas da camada e
sem aplicar `resolution_scale` novamente. Ver contrato DCP2 para amostragem,
cobertura, quotas e paridade/qualidade ainda pendentes antes da integração.

As fontes são **rasters já preparados**, eventualmente com estilos aplicados
antes pelo executor Rust. Esta fatia não chama esse executor, não aplica Fill
nem `Blend If`, não gera texto/forma e não decodifica ou codifica mídia.
Não há IDs persistentes, ownership de documento/histórico, cache ou handles.
Não é a ABI definitiva de `ComposeRequestV1`.

## 2. Ordem e arredondamento

A lista chega em ordem explícita inferior → superior. A UI atual armazena a
ordem inversa; a reversão será responsabilidade do adapter, uma única vez.
Saída começa transparente. Fundo sintético será uma entrada explícita do
adapter, não inferido da cor de uma camada pelo kernel.

Para cada camada visível com opacidade maior que zero, intersectar camada,
documento e região. Ler a fonte pelas coordenadas absolutas, não pela origem
local do tile. Aplicar `sourceAlpha * (opacity / 100)` sem quantizar essa
opacidade antecipadamente; opacidade aceita frações em `[0, 100]`.

Usar `composite_pixel_values`, compartilhado com os efeitos, com precisão
`f64` e arredondamento half-up para os bytes do resultado após cada camada.
RGB de fonte transparente não influencia a saída. Se alfa resultante arredonda
para zero, zerar também RGB. Entradas são somente leitura e preservadas.

Isso congela uma primeira semântica CPU testável, **não demonstra paridade
byte a byte com Canvas**. Premultiplicação interna, quantização e composição
do navegador podem divergir. Comparar a fronteira Canvas com tolerância
explícita antes de habilitar qualquer consumidor. A ordem de opacidade/
`Blend If` precisa de fixtures próprios antes de acrescentar esse passe.

## 3. Preflight e memória

Validar **todas** as camadas antes de limpar/escrever a saída, inclusive
invisíveis, fora da região ou com opacidade zero. Entrada inválida em uma
camada posterior não pode publicar uma composição parcial.

Limites conservadores iniciais, não novos limites de arquivo do aplicativo:

- Documento com dimensões positivas `u32`; não alocar seu raster inteiro.
- Região com origem/extensão representáveis no domínio `u32`, usando soma
  verificada; largura/altura positivas e até 16.384 por eixo.
- Fontes com largura/altura positivas e até 16.384 por eixo.
- Até 64 MiB por raster fonte ou saída; comprimentos devem ser exatos.
- Até 1.024 descritores por chamada.
- Até 96 MiB lógicos por job: saída + soma das fontes + 128 bytes de reserva
  por descritor. Contar referências repetidas ao mesmo buffer e camadas
  invisíveis conservadoramente; não pressupor deduplicação.

Função não aloca rasters, não usa `unsafe` e não modifica fontes. O chamador
fornece a saída. Rust impede alias mutável entre a saída e as fontes nesta API
segura; a futura ABI precisa verificar sobreposição e lifetime explicitamente.
O kernel não controla buffers previamente alocados pelo chamador, RSS,
heap do WebView ou jobs em outras instâncias. O adapter precisa fazer admission
**antes** de transferir/alocar e integrar o orçamento existente, sem adicionar
estes 96 MiB ao teto atual como se fossem um orçamento independente.

Erros tipados: `InvalidDocument`, `InvalidRegion`, `InvalidRaster`,
`InvalidOpacity`, `UnsupportedScale`, `MemoryBudget`, `TooManyLayers`.
Todo erro de preflight preserva a saída anterior byte a byte.

## 4. Provas desta fatia

Testes nativos no próprio módulo cobrem:

- Pilha vazia, inversão da ordem, alfa parcial e opacidade fracionária.
- Esperados fixos para os seis modos sobre fundo opaco e fonte sem tintura
  sobre fundo transparente; não gerar os esperados chamando o kernel.
- Camadas ocultas/opacidade zero e RGB invisível, incluindo alfa muito pequeno.
- Translação positiva/negativa, origem extrema `i32` e região na borda/fora
  do documento; preservar as fontes.
- Reconstituir o documento 7×5 com tiles de 1, 2, 3 e 7, recortando a última
  linha/coluna; comparar byte a byte em cada modo de mesclagem, com opacidade
  fracionária, transparência e fonte parcialmente fora do documento.
- Fonte posterior inválida, fonte escondida inválida, tamanho de saída
  incompatível, escala inválida, NaN/infinito, limites de eixos/bytes/jobs/
  camadas e somas de coordenadas. Erros não escrevem saída.

Os testes nativos da fatia 1 não são provas do adapter/WASM32, screenshots,
benchmark ou validação manual. A fatia 2 passou a exportar o núcleo por DCP1;
seus testes e diagnóstico são separados e descritos no contrato da ABI.

## 5. Consumidores a migrar, sem apagar o caminho atual

Inventário em `frontend/src/services/renderDocument.ts`:

| Entrada | Uso atual | Gate obrigatório antes da troca |
| --- | --- | --- |
| `renderDocumentPNG` / `renderDocumentBlob` | PNG pleno; Blob usado por `App.vue` | pixels plenos, fundo, estilos e cleanup |
| `renderDocumentExportBlob` | `useDocumentExport.ts` | DPI/escala, matte, formato/metadata e cancelamento |
| `renderSmartLayerContentBlob` | `smartLayerRenderer.ts` | conteúdo aninhado, densidade, revisões e sem cache obsoleto |
| `sampleDocumentColor` | conta-gotas em `App.vue` | região 1×1 com toda dependência inferior e mesma cor do render pleno |
| `renderLayerAppearance` | rasterização/cópia em `App.vue`, export de camada | modos local/isolated-export, viewport possivelmente negativo, não aplicar opacidade/mesclagem duas vezes |
| `renderDocumentThumbnail` | `useProjectLifecycle.ts` | escala reduzida, ordem e fallback de formato sem degradar exportação |
| `renderDocumentInteractiveBlendIfPreview` | `useDocumentBlendIfPreview.ts` | backdrop real, escala reduzida e quadro atual |
| `renderMergedLayers` | cópia/mesclagem em `App.vue` | bounds, fundo sintético, ordem, transparência e aparência preservada |

`renderDocument.test.ts`, `smartLayerRenderer.test.ts` e
`exportSettings.test.ts` são bases existentes, não prova de integração Rust.
O oráculo Canvas tem três documentos congelados; ampliar a matriz e adicionar
testes de cada adapter antes de substituir essas chamadas.

## 6. Sequência seguinte

1. Adapter/ABI privada de pilha preparada: implementado na fatia 2 como DCP1,
   runtime e Worker. Scheduler, admission global/revisions e cancelamento
   documental entre tiles ainda pendentes antes de consumidor editorial.
2. Transformações/grade global: primitiva e ABI DCP2 implementadas na fatia 3,
   com fixtures fracionárias, rotação, bordas e alpha sem emendas. Ainda validar
   filtro de minificação e paridade tolerante Canvas antes de consumidor real.
3. Integrar executor de estilos/fill, halos e `Blend If` subjacente sobre o
   backdrop da pilha; congelar ordem/quantizações contra o oráculo. A
   [fatia 4](contrato-pilha-estilizada-rust-v1.md) liga STG1/Fill/Esta camada
   à pilha nativa com fontes reutilizáveis. ABI/Worker, adapter de insets/unidades
   e filtro subjacente ainda pendentes.
4. Integrar um consumidor offscreen atrás de flag e ampliar pelos gates da
   tabela, compartilhando kernel, scheduler e orçamento. Não manter um
   compositor alternativo de aparência como otimização de preview.
5. Só então superfície única C4, rollout/QA e retirada condicionada do legado.

C3 continua aberto. Essa sequência não impede ajustes guiados por teste/medição.
Go/Wails, Vue, shaping de texto, arquivos `.axia`, idioma e versões não mudam.

## 7. Auditoria do orçamento entre janelas

`App.OpenLayerStyleWindow` abre `/?window=layer-styles`, sem a flag Rust.
`LayerStyleWindow.vue` edita parâmetros e emite eventos; `LayerStyleDialog.vue`
não cria rasterizador/Worker. O trabalho de preview acontece na janela
principal. Portanto, a janela atual não duplica o Worker Rust nem exige um
segundo orçamento Rust distribuído para esta configuração.

Isso **não** prova um teto global de memória do processo: existem Workers
legados e mídia do navegador. Instâncias privadas de diagnóstico/benchmark
também não podem ser somadas ao serviço do editor como se compartilhassem
admission. Se outra janela receber um compositor próprio ou houver serviços
concorrentes de preview/export, adicionar coordenação agregada e testes de
fechamento/crash/restart antes do rollout. A pendência do roadmap permanece
condicionada a esses cenários; não foi resolvida por um contador local novo.

## 8. Validação local — 2026-10-07

- `cargo test --offline --locked --manifest-path rust/axia-pixel-core/Cargo.toml`:
  **81** testes nativos, dos quais **20** novos da pilha documental.
- Mesmos **20** casos passaram com `--release`; `cargo fmt --check` passou.
- `npm test`: **587** casos frontend, incluindo verificação de tipos.
- `npm run test:rust-poc`: **366** casos existentes — cinco standalone, um
  smoke Worker e 360 scripts. Não exercitam a nova API documental.
- `go test ./...`, build e integridade do bundle passaram. WASM tem
  **100.674 bytes**, `axia_pixel_core-OI0exM4k.wasm`, 19 exports e nenhum export
  documental. A ABI antiga permanece; tamanho/hash do binário não são ABI.
- Diagnóstico Wails/Worker/WASM e smokes de preview **normal, Rust opt-in e
  WASM bloqueado/fallback** passaram no WebView2 `Edg/154.0.4258.62`.
  Preservaram buffers durante seleção/pan; caminho Rust manteve um Worker para
  três consumidores, e cleanup zerou consumidores/leases/cache. Nenhum desses
  smokes é prova visual do novo núcleo documental, ainda não integrado.
- `git diff --check` passou; avisos conhecidos de chunk >500 kB e tempo de
  plugins do build permanecem. Não criar instalador/portável nem ativar Rust
  por padrão nesta fatia. Validação manual da migração continua pendente.
