# Primeiro consumidor editorial Rust — C3, fatia 7

Estado: **composição offscreen real integrada sob flag**, sem rollout padrão.
`renderDocumentCanvas` pode usar o núcleo Rust para as chamadas de exportação
e conta-gotas suportadas. Não é mais apenas uma sonda de pacotes: a entrada é
`DocumentSpec`/`LayerItem[]`, e PNG/Blob/cor continuam saindo pelas APIs públicas
existentes. Não conclui toda a migração nem habilita a superfície única C4.

Atualização da [fatia 8](contrato-formas-documentais-rust-v1.md): formas simples
também são elegíveis, traçadas no Worker em pixels documentais, sem perder a
editabilidade. As provas da seção 6 abaixo registram a entrega original da
fatia 7; o novo contrato registra a cobertura/provas adicionais.

A [fatia 9](contrato-sessao-documental-rust-v1.md) substitui o término por chamada
pela sessão persistente limitada descrita abaixo. Evidências da seção 6 continuam
sendo o registro histórico da fatia 7.

A [fatia 10](contrato-aparencia-mesclagem-rust-v1.md) integra aparência isolada e
mesclagem, com domínio explícito de clipping, e restringe transformações raster
editoriais aos casos alinhados à grade com paridade validada.

Relacionado a [DCP3](contrato-blend-if-documental-rust-v1.md),
[SDP1/cache documental](contrato-cache-documental-wasm-v1.md),
[inventário dos consumidores](contrato-pilha-documental-rust-v1.md) e
[roadmap](roadmap-compositor-rust-internacionalizacao.md).

## 1. Habilitação, cobertura e fallback

Flag de URL **`axiaRustDocument=1`**, aplicado com recarga da janela. Sem ele,
não carregar o módulo/Worker documental por causa de uma exportação ou amostra.
Se também houver `axiaRustStyles=1`, o flag documental tem precedência e desliga
o experimento separado de estilos do preview nessa configuração. Não permitir
dois experimentos Rust disputando fontes/Workers por decisão implícita.
Não há ainda toggle de configuração nem coordenação geral entre janelas.
No executável recompilado, usar **`--axia-rust-document-preview`** para abrir a
janela com esse flag; ele tem precedência sobre `--axia-rust-styles-preview`.

Chamadas que chegam ao novo caminho:

- `renderDocumentPNG` e `renderDocumentBlob`;
- `renderDocumentExportBlob`, apenas quando a resolução de saída é elegível;
  formato, matte, DPI e metadata continuam no código existente após compor;
- `sampleDocumentColor`, com viewport documental 1×1 e retorno hexadecimal
  existente, sem aplicar uma composição diferente para o conta-gotas;
- `renderLayerAppearance`, nos modos local/isolated-export, inclusive fora do documento;
- `renderMergedLayers`, preservando recorte documental e dependências inferiores.

Cobertura inicial deliberadamente restrita:

- Imagens com fonte original e transformação alinhada à grade de pixels, ordem, opacidade, seis modos,
  Fill, efeitos STG1, padrões/texturas e ambos os filtros `Mesclar se`;
- fundo sintético preto/branco, incluindo Fill e opacidade existentes;
- fonte completa com padding, não um recorte sem halo da região pedida;
- saída em escala **1 pixel de saída por pixel documental**, inclusive conta-gotas.

Na fatia 7, formas usavam fallback; a fatia 8 cobre os quatro tipos sem efeitos
nem Blend If. Texto, fonte de imagem reduzida em relação à resolução original, mudança de escala
de saída, saída acima de 64 MiB/eixos acima de 16384, limites excedidos e erros
de plataforma/runtime permanecem no Canvas anterior. Camadas ocultas/fora dos
bounds relevantes não exigem suporte de um adapter que não seria usado.
Texto não é rasterizado destrutivamente nem perde a estratégia de nitidez atual.
Na fatia 12, texto Normal sem efeitos, Fill 100 e `Mesclar se` padrão entra no
consumidor, rasterizado transitoriamente pelo navegador na resolução documental
como na exportação legada; os demais casos seguem no fallback. Ver o
[contrato de texto](contrato-texto-documental-rust-v1.md).

Miniaturas, conteúdo inteligente aninhado e preview
interativo de Blend If ainda não são roteados para este consumidor. Não assumir
que todas as exportações de um documento já usam Rust: cobertura depende das
camadas, escala e limites daquela chamada.

Falha limpa o canvas parcial privado e refaz **a chamada inteira** no compositor
anterior; nunca publicar tiles misturados de backends/revisões diferentes.
Diagnóstico local em `document.documentElement.dataset.axiaRustDocument`:
`{backend, purpose, reason?}`. Não contém pixels/URLs de mídia. O erro original
do Canvas continua sendo propagado se ele também falhar.

## 2. Adapter editorial e unidades

`rustDocumentEditorial.ts` cria snapshot seletivo e imutável de metadados:
inverte a lista editorial para ordem inferior → superior, mantém o fundo
sintético no estágio anterior às camadas, resolve escala de estilos e cria
matrizes da fonte original. Não usa preview reduzido para exportação/amostragem.

Para fonte `Sw×Sh`, transformação `(x,y,W,H,rotation)`:

```text
a = cos(rotation) * W/Sw     b = sin(rotation) * W/Sw
c = -sin(rotation) * H/Sh    d = cos(rotation) * H/Sh
tx = x + W/2 - cos(rotation)*W/2 + sin(rotation)*H/2
ty = y + H/2 - sin(rotation)*W/2 - cos(rotation)*H/2
```

O Worker resolve insets na grade original. Com offsets `-left/-top`:
`txPrepared = tx - a*left - c*top`,
`tyPrepared = ty - b*left - d*top`. Não recentrar pelo raster expandido nem
escalar efeitos só porque há outra região de saída.

Escala dos efeitos de imagem segue a regra existente:
`1 / sqrt((W/Sw)*(H/Sh))`. A opacidade da camada continua fora de STG1 e entra
uma vez na composição documental. O fundo sintético usa fonte uniforme 1×1
transformada para os bounds do documento, sem alocar um raster de fundo pleno;
sua opacidade é o produto Fill/opacidade do caminho anterior.

Na primeira integração, uma transformação que reduz qualquer eixo da imagem
recusa o caminho novo. Isso não finge resolver o gate de minificação com uma
fonte reduzida ou bilinear ampliado. A matriz afim em si já suporta rotação;
a paridade browser ampla/antialiasing ainda exige expansão de fixtures.
Na fatia 10, novos casos demonstraram discrepância fora da tolerância para
reamostragem afim. O adapter agora recusa também ampliação/translação fracionária
e rotação que não preserve a grade (`source-transform-quality`). Matrizes de
fonte 1:1 pixel-aligned permanecem elegíveis; a ABI afim em si não mudou.
Na fatia 11, ampliação, translação fracionária e quartos de volta voltaram a ser
elegíveis com modos de amostragem raster compatíveis com Canvas (DCP4) e uma
sonda de plataforma; minificação foi medida e mantida em fallback. Detalhes no
[contrato de reamostragem raster](contrato-reamostragem-raster-rust-v1.md).

## 3. Trabalho no Worker

```text
snapshot editorial → fila → carregar Blobs com limite/AbortSignal
  → prepare-document-media [Worker documental exclusivo]
  → medir cabeçalhos → decode das fontes/assets → padding/planos STG1
  → SDP1/DCP3 → preparar Rust uma vez
  → tiles RGBA ≤256×256 pelo mesmo compositor
  → putImageData no canvas privado do consumidor → PNG/Blob/cor existentes
```

Reaproveita os decoders, normalização, insets, executor STG1 e composição
documental já testados. Canvas no Worker prepara conteúdo: decode de fontes/assets
e, a partir da fatia 8, traçado vetorial de formas. Estilos de imagem e blend da
pilha são calculados em Rust. Não copiar pixels intermediários para
a UI, codificar/decode PNG a cada tile ou reexecutar efeitos a cada região.

`prepare-document-media` é barreira RPC não cancelável isoladamente. O Worker
reserva modo documental quando ela é a primeira operação após init. Contexto
usado pelo protocolo geral não aceita essa preparação, e modo documental só
aceita prepare/compose/release documentais até init/dispose. Enquanto prepara
mídia, não admite outra transação. Init/dispose invalidam a geração; decoders
tardios não publicam. Erro de mídia preserva um documento anterior preparado.

Na fatia 9, o serviço conserva um Worker e uma preparação entre chamadas
compatíveis, com igualdade exata do snapshot e mídias imutáveis. Envia a grade
atual a cada tile, sem repetir decode/estilos em cache hit. Mudança libera o
documento anterior antes de carregar a nova mídia; fontes externas mutáveis não
mantêm pixels em cache. Cinco segundos sem trabalho encerram o Worker. Término
é drenado antes de abrir outro contexto; falhas/dispose descartam o residente.
Isso ainda não é scheduler incremental/definitivo do canvas ao vivo. Detalhes,
invalidação e provas no [contrato da sessão](contrato-sessao-documental-rust-v1.md).

## 4. Limites e ciclo de vida

- Uma transação ativa e até **três pendentes**, FIFO. Cada snapshot seletivo
  tem até **1 MiB**; antes de criar a identidade/clone, o planner limita os
  metadados acumulados das imagens a **512 KiB**. A fonte é carregada só ao
  despachar, não para todos os pedidos pendentes.
- Até **32 camadas** preparadas, somando fundo; até **47 MiB** de rasters padded
  e assets decodificados no preflight Worker; cada imagem intrínseca também
  precisa caber em 47 MiB (era 16 MiB até 2026-10-27). O valor foi medido: o
  preparo mantém pacote e documento preparado ao mesmo tempo no orçamento de
  96 MiB do núcleo, e uma foto de 12 MP (4000×3000, 45,8 MiB) cabe com pico de
  92,7 MiB de memória WASM. Os limites vivem em `rustDocumentBudget.ts`.
- Camada raster sem efeitos, com Fill 100 e sem `Mesclar se` próprio não leva
  STG1: o núcleo compõe a fonte direto, sem cópia estilizada residente nem pico
  2× (prova exaustiva em `stages.rs`). A decodificação no Worker documental
  admite até 4× o orçamento de fontes como pico transitório JS/GPU (arquivo,
  bitmap, canvas e leitura), liberado antes de montar o pacote; sem insets, o
  raster lido vira a fonte do pacote sem cópia, e o DCP é escrito dentro do SDP1.
- Blobs codificados somados até **32 MiB**, incluindo referências repetidas.
  Leitor streaming existente valida tamanho declarado/real, usa saldo restante
  e cancela leitura em abort/limite. Assets não são buscados por URL no Rust.
- Continuam os budgets/quotas DCP/STG1 de 64/96 MiB e pass-pixels. O primeiro
  tile, de no máximo 256×256, é a região planejada de preparação; o canvas
  completo fica no consumidor, não como saída plena alocada no WASM.
- Deadline ativo de **30 s**, incluindo carga/conexão/preparação/tiles; não
  inclui espera na fila. RPC tem o deadline existente de 10 s. Release/terminação
  são drenados antes de resolver a transação; cleanup pode acrescentar esse
  prazo RPC. Timeout encerra o contexto, rejeita fila e abre circuito até recarga.
  Indisponibilidade de WASM também interrompe novas tentativas no serviço.
- Dispose aborta ativo/fila. Falha ao pintar, exceção de processamento ou
  resposta inválida também termina o Worker. Resultado obsoleto não pinta após
  abort. Uma falha de término impede despachar novos contextos.

Os tetos locais limitam a admissão do experimento, não provam RSS/GC, orçamento
global de processo, Workers legados, fontes/browser nem memória entre janelas.
O canvas de saída e a codificação PNG/formatos continuam sendo recursos do
consumidor. Não somar estes limites como uma reserva extra permitida ao serviço
atual de estilos. Os dois flags exigem recarga; alteração dinâmica de URL não
é mecanismo de troca de contextos suportado.

## 5. Evidência e sequência de migração

Testes puros usam os objetos editoriais reais e cobrem fundo/ordem/snapshot,
matriz de rotação/padding, conta-gotas, fallback de qualidade e limites antes do
decode. Testes Worker/WASM cobrem mídia → estilos → composição, isolamento de
protocolo, cache preservado em erro, fila limitada, deadline e cleanup em falha.
Os decoders/Canvas de Node são doubles identificados; não são prova de PNG real.

O oráculo de browser mantém os três goldens antigos e as 24 comparações DCP3.
Acrescenta **dois documentos editoriais**, exercitados por **PNG, Blob e
conta-gotas**, exigindo `backend=rust`, mais fallback explícito de forma. Há
efeitos, Fill, `Mesclar se`, alfa parcial e fundo branco. Tolerâncias anteriores
de alfa 2/RGB premultiplicado 3 são preservadas; nesta rodada os máximos foram
**1** e **1,0510**. O conta-gotas admite diferença máxima 2 por canal hexadecimal.
Nenhum golden foi regravado.

Diagnóstico do executável Wails também chama as APIs públicas de Blob e cor,
exige backend Rust e confere PNG real de sombra/overlay com Fill zero. Encerra
os contextos anteriores antes dessa prova. Não é validação manual do usuário.

Próximos gates, na ordem de remoção segura:

1. Ampliar adapters de texto/formas sem regressão de nitidez, provar minificação
   e escalas/resoluções de saída; ampliar matriz Canvas e formatos/metadata.
2. Ampliar a sessão persistente limitada da fatia 9 com agendamento/revisões/admission e cancelamento
   por consumidor; ampliar miniatura e smart content. Aparência/mesclagem já
   estão ligadas sob flag na cobertura delimitada da fatia 10.
3. Integrar superfície única C4 com tiles visíveis/dirty regions e overlays de
   interação; medir pan/zoom, memória e qualidade com documentos reais.
4. Promover por gates/QA e retirar cada fallback após inspeção de referências e
   testes de seus chamadores. Só então remover compositor Canvas, DOM por camada,
   handoff e protocolos antigos sem consumidor remanescente.

Nesta fatia não há remoção de legado, mudança de versão/idioma/`.axia` ou
instalador/portável. Go/Wails, Vue e shaping de texto permanecem na stack.

## 6. Validação local — 2026-10-19

- Frontend **593/593** e typecheck do app/suítes passaram; seis casos editoriais
  novos. WASM/Worker **417/417**: **411** scripts, cinco casos standalone WASM
  e um standalone Worker. Há dez casos novos de mídia/serviço e uma nova prova
  da barreira RPC. O subconjunto de **27 testes** passou **três vezes**.
- Rust nativo **132/132**, sem alteração dos algoritmos ou do binário WASM
  nesta fatia. `go test ./...` passou, incluindo URL de startup/precedência
  do novo flag; `gofmt` e `git diff --check` passaram.
- Oráculo browser passou: três goldens preservados, 24 casos DCP3, dois
  documentos editoriais × PNG/Blob/conta-gotas e fallback de forma explícito.
  Máximos editoriais: alfa **1**, RGB premultiplicado **1,05098**.
- Build Vite e bundle passaram: `axia_pixel_core-BfefQY4S.wasm`, **124718 bytes**,
  íntegro contra Cargo; Worker `rustPixelPoc.worker-BSDxTz8G.js`. O grafo inclui
  o consumidor documental lazy, sem habilitá-lo por padrão.
- Diagnóstico Wails incorporado passou usando PNG real no Worker e as APIs
  públicas de Blob/conta-gotas com backend Rust. Smokes do preview normal,
  estilos Rust opt-in e fallback forçado passaram, sem perder estado ativo.
  Preview Rust manteve um Worker e zerou leases ao limpar; o consumidor
  documental termina cada Worker antes de resolver a chamada.
- Ambiente: Node **24.14.1**, Rust **1.98.1**, Go **1.26.5**, Windows
  **10.0.26200**, Edge do oráculo **155.0.4283.45** e WebView2 dos smokes
  **155.0.4283.62**.

Não houve benchmark de FPS, validação manual, promoção do flag, geração de
distribuição ou retirada do fallback. Os testes de mídia Node usam doubles de
decode identificados; browser/Wails fornecem a prova separada de PNG real.
