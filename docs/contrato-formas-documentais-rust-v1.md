# Formas no consumidor documental Rust — C3, fatia 8

Estado: **retângulo, elipse, triângulo e estrela elegíveis no consumidor
offscreen experimental**, com Fill, opacidade, posição fracionária, rotação e
os seis modos da pilha. Reutiliza `axiaRustDocument=1` ou o argumento nativo
`--axia-rust-document-preview`; sem o flag, o caminho padrão não muda.

Relacionado ao [consumidor editorial](contrato-consumidor-documental-rust-v1.md),
[DCP3](contrato-blend-if-documental-rust-v1.md) e ao
[roadmap](roadmap-compositor-rust-internacionalizacao.md).

## 1. Fonte vetorial temporária, não rasterização da camada

A camada e sua geometria continuam vetoriais/editáveis no modelo e no `.axia`.
Somente a fonte transitória usada na composição é convertida para RGBA, no
Worker. O traçado é o mesmo `traceShapePath` do editor/Canvas; não há outro
algoritmo de estrela, superelipse ou cantos arredondados implementado em paralelo.

Não usar `baseWidth × baseHeight` como resolução de bitmap a ampliar/reduzir.
O Worker desenha a forma **diretamente em pixels documentais de saída**,
aplicando a transformação vetorial antes da leitura dos pixels:

```text
shape + transform + Fill/opacidade
  → bounds documentais inteiros e recortados no documento
  → OffscreenCanvas privado no Worker
  → translate(center − origem) → rotate → scale(display/base)
  → traceShapePath na geometria base → fill
  → RGBA8 pronto na grade documental
  → DCP2/DCP3 com matriz identidade + translação inteira
  → composição Rust dos tiles finais
```

Canvas prepara o conteúdo vetorial; Rust mantém a composição da pilha. A fonte
não sofre outra escala/rotação como bitmap depois de traçada. O sampler afim
existente recebe uma correspondência 1:1 de centros de pixel, não um proxy de
baixa resolução. Formas podem ser reduzidas em relação às dimensões vetoriais
base sem cair na restrição de minificação de **imagens raster**.

O snapshot é seletivo: configuração normalizada da forma, dimensões base e
campos de transformação usados pelo traçado. Não altera o objeto editorial nem
carrega campos adicionais do modelo como parte do descritor.

## 2. Bounds, clipping e alfa

O planner calcula o AABB da geometria transformada, usa `floor(left/top)` e
`ceil(right/bottom)` e intersecta com `[0, documentWidth) × [0, documentHeight)`.
Não recorta no tile solicitado: conta-gotas e render pleno recebem a mesma
fonte/geometria. Uma forma inteiramente fora do documento não aloca fonte.

A origem de preparação é inteira. O traçado preserva suas coordenadas
fracionárias ao subtrair essa origem do centro. Isso mantém cobertura nas bordas
e evita ampliar uma fonte suavizada ou aplicar a rotação uma segunda vez.
Esse clipping só atende os consumidores já ligados de documento/conta-gotas;
não autoriza reutilizar o adapter em exportação isolada fora do documento.

O Canvas anterior calcula `globalAlpha = layer.opacity/100` e depois multiplica
por Fill. A fonte guarda **esse alfa normalizado**, com a mesma ordem de
operações: `(layer.opacity / 100) * layerStyleFillOpacity(styles)`. O Worker usa
esse valor ao preencher a forma. Não converter primeiro para porcentagem nem
arredondar alfa numa etapa adicional.

Como cobertura/Fill/opacidade já estão nos pixels RGBA8, o descritor documental
usa opacidade **100**, matriz `[1, 0, 0, 1, originX, originY]` e **nenhum STG1**
para essa fonte (`null` na tabela SDP1). O modo de mesclagem continua sendo o da
camada, aplicado somente pelo compositor Rust. Isso evita aplicar Fill/opacidade
duas vezes e preserva as bordas em alfa parcial.

## 3. Validação, limites e lifecycle

Antes de criar Canvas, o Worker recompõe e valida os bounds pelo documento,
confere dimensões/origem, matriz 1:1, opacidade documental 100, Fill de entrada
100 e ausência de efeitos/Blend If nessa fonte já preparada. Descritor que
tenta acrescentar outro transform/Fill/opacidade é rejeitado, não corrigido
silenciosamente. Matrizes esparsas também não passam pela comparação densa.

Planner valida tipo de forma, cor hexadecimal RGB, valores finitos, dimensões
positivas, escala vetorial finita/limitada e alfa em `[0,1]`. Cores/valores não
elegíveis caem na política existente de fallback, sem pintar com uma cor padrão
por acidente. O mesmo normalizador do traçado resolve cantos, proporções e
quantidade de pontas válidos.

Mantêm-se os tetos da fatia 7: até 32 camadas, 16 MiB agregados de fontes padded
e assets, eixo até 16384 e limites de metadata/saída/quotas do núcleo. O tamanho
de uma forma é o raster projetado recortado, não apenas suas dimensões base.
Formas grandes não ficam isentas do orçamento por não terem Blob.

Forma não baixa arquivo, chama `createImageBitmap` ou codifica PNG intermediário.
O canvas de preparação é reduzido a 1×1 em `finally`, inclusive após erro de
readback/invalidação. Geração/cancelamento, fila, release, terminação e descarte
do canvas parcial do consumidor mantêm o contrato da fatia 7. Tiles reutilizam
a fonte e não refazem o traçado.

## 4. Cobertura e próximos gates

Os quatro tipos incluem cantos arredondados, superelipse, pontas/proporção de
estrela, resize não uniforme, rotação e bounds fracionários. As APIs já ligadas
de PNG/Blob, exportação elegível e conta-gotas podem usar essas formas junto
de imagens e fundo sintético.

Efeitos e `Blend If` em forma vetorial continuam fora desta integração, como no
compositor anterior. O planner retorna `shape-style` e o fallback conserva a
validação/rejeição existente; esta fatia não habilita uma feature editorial nova
de estilos vetoriais. Texto permanece no caminho anterior. O caso explícito de
fallback do oráculo passa a usar texto, pois forma simples agora é elegível.

Escala de saída diferente de 1:1, minificação de imagem, texto/fontes, demais
consumidores, sessão persistente/admission e superfície única C4 continuam gates.
Nenhuma mudança de nitidez/interação do texto, versão, idioma, stack ou formato
de projeto foi feita. Não remove legado nem ativa o experimento por padrão.

## 5. Provas

- Testes editoriais cobrem quatro tipos, redução vetorial, snapshot imutável,
  alpha/Fill uma vez, matriz 1:1 para forma rotacionada/fracionária, clipping
  documental, fonte completa no conta-gotas e rejeição de estilo/geometria/cor.
- Node/Worker/WASM confirma STG1 ausente, alfa esperado, tiles reutilizados e
  nenhum decode raster; rejeita fonte adulterada antes de alocar Canvas e
  verifica cleanup em cancelamento. Seu Canvas é um **double de chamadas**, não
  prova da cobertura geométrica de curvas/polígonos.
- Oráculo de browser compara **24 casos reais**: quatro formas × seis modos,
  com rotação, posições/tamanhos fracionários, Fill/opacidade parciais, fundo
  transparente/branco e forma/imagem inferior semitransparente. Exige backend
  Rust nas APIs públicas. Tolerâncias fixas: alfa **2**, RGB premultiplicado
  **3**; máximos medidos **1** e **1,9765**, respectivamente, na matriz mista
  final de formas/imagens. Não regrava goldens.
- Os três documentos congelados, 24 comparações DCP3 e dois documentos
  editoriais PNG/Blob/conta-gotas permanecem. O diagnóstico Wails acrescenta
  forma em Blob real e conta-gotas, exigindo backend Rust e alfa 64 para
  opacidade 50% × Fill 50%, sem rasterizar a camada no modelo.

São provas automáticas locais, não garantia geral de FPS, RSS, GPU, todas as
fontes/plataformas ou paridade universal de antialiasing. Validação manual e
ampliação dos documentos reais continuam necessárias antes do rollout.

## 6. Validação local — 2026-10-19

- Frontend **597/597**, com quatro casos editoriais novos; typecheck do app e
  das suítes passou. WASM/Worker **421/421**: **415** scripts, cinco casos
  standalone WASM e um standalone Worker. Quatro testes novos verificam a fonte
  vetorial e sua integração; doubles de Canvas são identificados nos nomes.
- O subconjunto de **35 testes** editoriais/mídia/RPC passou **três vezes**.
  Rust nativo **132/132**, `cargo fmt --check`, `go test ./...` na raiz e
  `git diff --check` passaram. Não houve mudança dos algoritmos Rust.
- Oráculo real passou com os 24 casos novos de formas, 24 DCP3, três goldens
  preservados e as provas PNG/Blob/conta-gotas anteriores. O fallback explícito
  agora usa texto, sem habilitar um raster textual alternativo.
- Build Vite e bundle passaram: WASM `axia_pixel_core-BfefQY4S.wasm`, **124718
  bytes**, inalterado/íntegro contra Cargo; Worker `rustPixelPoc.worker-TnbjmuHD.js`.
- Diagnóstico Wails incorporado passou com forma vetorial via Blob e conta-gotas
  reais. Smokes de preview normal, estilos Rust opt-in e fallback forçado também
  passaram com `lostActive=false`; preview Rust preservou um Worker e zerou
  leases ao limpar. O preview padrão não foi migrado nem modificado.
- Ambiente: Node **24.14.1**, Rust **1.98.1**, Go **1.26.5**, Windows
  **10.0.26200**, Edge do oráculo **155.0.4283.45** e WebView2 **155.0.4283.62**.
  Uma execução do oráculo avisou que seu perfil temporário ainda estava em uso.

Sem benchmark de FPS/RSS, QA manual, instalador, portável, mudança de versão,
ativação por padrão ou exclusão de legado nesta entrega.
