# Mesclar se subjacente na pilha Rust — C3, fatia 6

Estado: **integrado ao núcleo, DCP3, WASM/runtime e Worker experimentais**.
O filtro `Camada abaixo` consulta o backdrop da pilha durante a composição de
cada região. Não depende de um raster de backdrop enviado pelo frontend nem
faz parte dos pixels estilizados em cache. Preview padrão/exportação continuam
no compositor anterior; não fecha C3/C4 nem substitui `renderDocument.ts`/DOM.

Relacionado ao [cache SDP1](contrato-cache-documental-wasm-v1.md),
[transformações DCP2](contrato-transformacoes-documentais-rust-v1.md),
[preparador de estilos](contrato-pilha-estilizada-rust-v1.md) e
[roadmap](roadmap-compositor-rust-internacionalizacao.md).

## 1. Ordem visual e quantização

`DocumentRasterLayer.underlying_blend_if` e
`RustDocumentRasterLayer.underlyingBlendIf` são opcionais. Canais: cinza,
vermelho, verde e azul; quatro thresholds inteiros em `[0, 255]`, ordenados
`shadowStart ≤ shadowEnd ≤ highlightStart ≤ highlightEnd`. O canal cinza usa
os coeficientes/evaluation order do kernel existente. Cortes duros mantêm as
desigualdades estritas existentes; não introduzir epsilon.

```text
fonte completa com insets
  → estilos/Fill → Esta camada                   [preparação reutilizável]
  → amostragem afim + cobertura → opacidade
  → fonte RGBA8 → Camada abaixo → blend da camada [por região]
```

O caminho Canvas atual desenha a camada com opacidade num canvas intermediário,
lê seus bytes, modifica o alfa pelo filtro e só então aplica o modo de mesclagem
à pilha. O núcleo congela explicitamente essa ordem para filtro ativo:

```text
alpha0 = round(sampleAlpha * layerOpacity / 100)
factor = existingBlendIfOpacity(composedBackdropRGB)
alpha1 = round(alpha0 * factor)
sourceRGB = round(clamp(sampleRGB, 0, 255))
compositePixel(backdrop, sourceRGB, alpha1, layerBlendMode)
```

Não fundir `round(alpha * opacity)` e `round(alpha * factor)`: em alfa baixo o
resultado muda. Opacidade é aplicada uma única vez; Fill/Esta camada já estão
na fonte preparada. Todos os tipos de efeito são filtrados como parte dessa
aparência, inclusive externos dentro dos insets. O filtro não reexecuta STG1.

Backdrops são os bytes RGBA8 já compostos das camadas inferiores, antes de
adicionar a camada atual. Camadas consecutivas filtradas leem o resultado
atualizado. O fator usa apenas RGB, sem ponderá-lo novamente pelo alfa do
backdrop, como o filtro TypeScript e o kernel isolado anteriores. Um backdrop
totalmente transparente na pilha é preto transparente: RGB oculto de uma fonte
transparente não vaza para a decisão.

Sem filtro, preservar exatamente o caminho anterior de alfa/RGB fracionários.
Os ranges padrão `[0, 0]/[255, 255]` também são no-op, independentemente do canal:
não acrescentar quantização só porque existe um descritor de filtro default.

Filtro é validado inclusive em camadas ocultas/opacidade zero. Rejeição ocorre
antes de limpar/escrever a saída (`InvalidBlendIf` nativo, status `2` na ABI).
Não há buffer extra de documento/camada/backdrop: consulta e composição são
feitas no pixel de saída atual. O núcleo reaproveita o cálculo de opacidade do
kernel `blend_if.rs`, não cria outra curva de thresholds.

## 2. ABI privada DCP3

DCP1 e DCP2 não mudam de layout nem de significado. DCP3 é uma nova versão
para fontes afins com filtro opcional por camada. Header de **80 bytes**, igual
ao DCP2 exceto magic ASCII `DCP3` e version u32 `3`.

Cada registro tem **96 bytes**. Seus primeiros 80 bytes são os mesmos do DCP2;
o offset RGBA continua relativo ao início do pacote e considera o registro maior.

| Offset no registro | Campo | Regra |
| --- | --- | --- |
| 80 | enabled, u32 | `0` ou `1` |
| 84 | channel, u32 | `0` cinza, `1` vermelho, `2` verde, `3` azul |
| 88 | shadowStart, u8 | Threshold |
| 89 | shadowEnd, u8 | Threshold |
| 90 | highlightStart, u8 | Threshold |
| 91 | highlightEnd, u8 | Threshold |
| 92–95 | reservado | Todos zero |

Filtro ausente exige os 16 bytes adicionais todos zero. Filtro presente exige
canal/ranges válidos mesmo se o resultado for no-op. Pacote DCP3 com todos os
filtros ausentes é aceito; seu tamanho/orçamento usa registros de 96 bytes,
sem inferir 80 pela ausência de filtros. Não aceitar alias/gaps/trailing bytes.

O encoder tipado escolhe DCP3 quando alguma camada possui `underlyingBlendIf`;
exige grade e matrizes explícitas, como DCP2. Fontes sem filtro continuam sendo
codificadas como DCP1 ou DCP2. O núcleo seguro Rust também aceita filtro no
caminho inteiro; a ABI não cria um segundo layout inteiro para ele.

`axia_poc_document_packet_version()` agora retorna **3**. Export regional
continua com quatro argumentos. Runtime verifica a capacidade antes de enviar
DCP3, tanto avulso quanto dentro de SDP1: WASM de capacidade 2 permanece válido
para DCP1/DCP2, mas retorna `wasm-unavailable` para pedidos DCP3 antes do upload.
Não alterar silenciosamente o significado dos pacotes anteriores.

SDP1 aceita DCP3 como documento interno, sem mudar versão, header, tabela STG1
ou export de cinco argumentos. Preparação preserva os 96 bytes de cada registro
e substitui somente RGBA. Os efeitos continuam executados uma única vez. Cache,
substituição atômica, gerações/IDs, releases e barreiras Worker mantêm o contrato
da fatia 5. Nenhum novo Worker/serviço editorial é criado.

## 3. Reuso, memória e trabalho

Tiles compõem todas as camadas inferiores relevantes à sua região antes de
avaliar o filtro. Não aceitar backdrop de uma revisão antiga nem reutilizar o
resultado filtrado como se dependesse apenas da camada atual. Alterações em
fontes/estilos/geometria/filtro/camadas inferiores exigem nova preparação no
cache atual. Grade/região podem variar sem nova preparação; o backdrop é
recalculado na grade solicitada. Futuro cache de tiles precisa invalidar as
dependências superiores; ainda não há dirty-region scheduler documental.

Continuam os limites de 64 MiB por pacote/raster, 96 MiB agregados, 1024 camadas
e quotas STG1. Registros maiores entram no orçamento TypeScript/Rust; o teste
nativo de tamanho confirma que o descritor cabe nos 128 bytes reservados.

Com grade, o filtro aproveita a quota existente de **16 * 1024 * 1024** amostras
transformadas por pedido, incluindo todos os pixels dos bounds conservadores.
No caminho inteiro nativo, filtros ativos também contam interseções executadas
nesse teto; erro `WorkBudget` ocorre antes da escrita. Camadas ocultas/default
não acrescentam trabalho de filtro. A quota é conservadora, não prazo/FPS/RSS
ou orçamento global entre janelas.

## 4. Evidência e limites de paridade

- Comparação exata com `apply_underlying_region` existente cobre quatro canais,
  seis modos e backdrop com alfa parcial; teste dedicado fixa o arredondamento
  duplo. Default mantém o resultado fracionário anterior.
- Testes nativos cobrem transparência/RGB oculto, filtros consecutivos, filtro
  inválido oculto/opacidade zero, amostragem fracionária, tiles e quota inteira.
  DCP3 rejeita flags/canais/ranges/reservados inválidos sem alterar a saída.
- WASM real compara os quatro canais/seis modos com
  `applyLayerStyleBlendIfUnderlying` TypeScript, após transformação/opacidade;
  não apenas com uma cópia do novo algoritmo.
- Cache SDP1+DCP3 com Fill, overlay e Esta camada é comparado com kernels
  separados; tiles 1/2/3/7, rotação, zoom/pan e restauração da grade concordam
  byte a byte. Falha de preparação preserva cache/geração. Worker real cobre
  transfers e release. WASM de capacidade 2 é recusado sem perder o cache DCP2.
- O oráculo de browser preserva os **três documentos congelados**, sem regravar
  goldens, e acrescenta **24 comparações Rust/Canvas** (quatro canais, seis
  modos, rampas/cortes duros, alfa parcial). Tolerâncias fixadas antes da execução:
  alfa até **2** bytes e diferença RGB premultiplicada até **3** na escala 0–255.
  Edge **155.0.4283.45** apresentou máximos de **1** e **1,4353**, respectivamente.
  A métrica premultiplicada evita supervalorizar RGB instável próximo de alfa zero.

Essas comparações Canvas são recortes pequenos em escala 1, com imagens alinhadas;
não provam paridade de todo documento, texto, rotação/antialiasing do browser,
minificação, grupos/máscaras nem hardware/plataformas diferentes. Nos testes de
transformação, a comparação exata é com as primitivas raster existentes.
Permanecem necessários adapters editoriais de insets/unidades/resolução,
scheduler/revisões/admission, minificação de alta qualidade, matriz Canvas mais
ampla e primeiro consumidor offscreen atrás de flag. Só depois, superfície C4.

Não altera versão distribuída, stack, idioma, modelo/histórico, `.axia`, preview
padrão ou exportação. Não gera instalador/portável, não remove fallback/legado e
não afirma ganho de FPS no editor sem medição.

## 5. Validação local — 2026-10-19

- Rust **132/132**, em debug e release; dez casos novos, sem alteração dos
  resultados anteriores. `cargo fmt --check` e `git diff --check` passaram.
- Frontend **587/587**, typecheck do app e das suítes passaram.
- WASM/Worker **406/406**: **400** scripts, cinco casos standalone WASM e um
  standalone Worker. Nove testes novos documentais incluem admissão no limite
  de 96 MiB de DCP3 com todos os filtros desabilitados. O subconjunto de
  **49 testes** documentais/RPC passou **três vezes**.
- `npm run smoke:document-oracle` passou com os três documentos congelados e
  as 24 comparações novas. O prehook prepara o WASM; gravar fixtures também
  exige esse build. Nenhum golden foi regravado.
- Build e bundle passaram: `axia_pixel_core-BfefQY4S.wasm`, **124718 bytes**,
  íntegro contra Cargo, e Worker `rustPixelPoc.worker-DTaAy0WU.js`. Continua o
  aviso de chunk JS acima de 500 kB, sem falha de build.
- `go test ./...` passou. Diagnóstico Wails incorporado confirmou DCP3 dentro
  de SDP1 e o caso de arredondamento duplo. Primeira tentativa concorrente
  terminou em timeout CDP; repetição isolada passou. Não foi necessário mudar
  timeout ou código para mascarar a falha.
- Smokes Wails de preview normal, Rust opt-in e fallback forçado passaram com
  `lostActive = false`. Rust manteve um Worker para três consumidores e zerou
  leases na limpeza; fallback não abriu Worker Rust.
- Ambiente: Node **24.14.1**, Rust **1.98.1**, Go **1.26.5**, Windows
  **10.0.26200**, Edge do oráculo **155.0.4283.45** e WebView2 dos smokes
  **155.0.4283.62**. Uma execução de preview avisou que seu perfil temporário
  ainda estava em uso; os smokes não geraram distribuição instalável/portável.

São provas automáticas locais, não QA manual, benchmark documental ou gate
multiplataforma concluído. A integração permanece experimental.
