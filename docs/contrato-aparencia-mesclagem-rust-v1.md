# Aparência isolada e mesclagem Rust — C3, fatia 10

Estado: **dois consumidores adicionais sob o flag documental experimental**.
`renderLayerAppearance` e `renderMergedLayers` podem usar a mesma sessão/kernel
de PNG/Blob/conta-gotas. Preserva as APIs, bounds retornados, ordem e política
de fallback integral. Não habilita Rust por padrão nem remove o compositor antigo.

Relacionado ao [consumidor editorial](contrato-consumidor-documental-rust-v1.md),
[formas](contrato-formas-documentais-rust-v1.md),
[sessão persistente](contrato-sessao-documental-rust-v1.md) e
[inventário de consumidores](contrato-pilha-documental-rust-v1.md).

## 1. Políticas de bounds

O planner recebe uma política explícita, sem um segundo algoritmo de composição:

| Política | Consumidores | Domínio do núcleo | Grade |
| --- | --- | --- | --- |
| `document` | exportação, conta-gotas e mesclagem | tamanho original do documento | origem da viewport no documento |
| `appearance` | aparência isolada | tamanho inteiro da viewport visual | origem `(0,0)`, com fontes transladadas |

A mesclagem mantém o recorte no documento que a API já fazia. Não ampliar seus
bounds por causa de uma sombra externa nem perder a dependência inferior do
`Mesclar se`. Fontes/estilos continuam completos; o tile não limita seu halo.

A aparência isolada **não** pode usar o clipping original do documento:
uma camada pode estar toda fora dele ou ter sombras que ultrapassam suas bordas.
O plano existente `layerAppearanceRenderPlan` calcula os bounds estilizados,
arredonda para fora e mantém a posição editorial original no retorno da API.
Para viewport `(vx,vy,Vw,Vh)`, a tradução transitória é:

```text
documento do núcleo = Vw × Vh
grade de saída = escala 1:1, origem (0,0)
matriz raster = [a,b,c,d,tx-vx,ty-vy]
forma = mesma geometria, com transform.x -= vx e transform.y -= vy
fundo sintético = retângulo original em (-vx,-vy), não um fundo da viewport toda
retorno público = Blob + (vx,vy,Vw,Vh) originais
```

Somente a tradução muda. Base afim, fonte original, insets STG1, luz e unidades
dos efeitos não mudam. O Worker continua corrigindo padding na base da matriz
antes da composição Rust. Não deslocar o conteúdo duas vezes pelo tile/grid.
Formas são traçadas diretamente no frame normalizado; o Worker valida os bounds
nesse frame, não contra o documento editorial original.

Origem da aparência precisa ser inteira/segura e ter módulo até `u32::MAX`.
Não aceitar coordenada extrema ou fracionária como se tivesse sido arredondada
pelo plano público. Tetos de saída, metadata, fontes e núcleo continuam iguais.

## 2. Opacidade, Fill e mesclagem

As decisões continuam no plano público existente:

- `local` força visibilidade e opacidade externa 100%, blend externo normal;
- `isolated-export` força visibilidade, mantém opacidade externa, blend normal;
- Fill, efeitos e `Mesclar se — Esta camada` continuam no conteúdo preparado;
- `Mesclar se — Camada abaixo` continua sendo rejeitado ao isolar uma camada,
  pois depende da pilha. Não simular um backdrop transparente silenciosamente;
- na mesclagem, ordem/modos/opacidades e filtro da camada abaixo continuam
  recebendo a pilha inferior real pelo mesmo kernel documental.

Não altera a camada editorial nem rasteriza texto/forma no modelo. O Blob
temporário só substitui a camada se o chamador editorial executar essa operação.

Depois de codificar o PNG, o canvas privado das duas APIs é reduzido a 1×1 em
`finally`, inclusive em falha de codificação. O Blob já codificado e seus bounds
continuam válidos. Essa limpeza vale para o caminho Rust e o fallback Canvas.

## 3. Gate de qualidade encontrado pelos novos casos

A matriz browser nova revelou divergência **real** entre o sampler afim Rust
e Canvas em imagem estilizada com rotação/translação fracionária. No caso
rotacionado 90°, posição `(8,5;6,25)`, o máximo de alfa/RGB premultiplicado foi
**119/119**, muito acima da tolerância **2/3**. Não regravar golden nem elevar
tolerância para fazer a comparação passar.

O adapter editorial passa a exigir, **em todos os consumidores experimentais**,
matriz raster alinhada à grade de pixels: base ortonormal com componentes
inteiras e translação inteira. Isso cobre a fonte original 1:1, translações
inteiras e rotações de quartos de volta que também preservem esse alinhamento.
Resíduo numérico até `1e-9` é tolerado na verificação, sem mudar a matriz real.
A origem de saída também precisa ser inteira (`output-grid-quality` nos demais
casos). As APIs ligadas já arredondam essa origem antes do planner; não permitir
que uma grade fracionária reintroduza reamostragem por outro caminho.

Raster reduzido mantém `source-minification`; ampliação, transformação
fracionária ou outra rotação usam `source-transform-quality`. O fallback refaz
a chamada inteira no Canvas anterior. Esse endurecimento também protege os
consumidores das fatias 7–9, não apenas as duas APIs novas.

A primitiva DCP2/DCP3 continua aceitando transformações afins para testes e
desenvolvimento: a ABI não mudou. O que não está provado é sua equivalência
visual ao Canvas no adapter editorial. Resolver reamostragem/minificação com
fixtures, custo e cobertura de bordas continua obrigatório antes do rollout.
Formas não sofrem essa restrição raster: são traçadas na resolução documental
antes de receber uma matriz identidade + origem inteira.

Atualização (fatia 11): a divergência é consistente com uma diferença de
semântica — o sampler de cobertura aplica antialiasing geométrico na borda, o
`drawImage` alinhado a eixos recorta por retângulo de pixels; uma borda em meio
pixel dá ~50% de cobertura contra 0 ou 100%, compatível com os 119. Novos modos raster
reabrem ampliação, translação fracionária e quartos de volta; minificação e
rotação arbitrária continuam recusadas. Ver o
[contrato de reamostragem raster](contrato-reamostragem-raster-rust-v1.md).

## 4. Provas

- Testes editoriais verificam origem negativa, conteúdo externo, translação
  da matriz/forma/fundo, preservação da luz/unidades, snapshot sem mutação,
  modos local/export e gates de transformação/coordenadas/tipos.
- Worker/WASM real verifica halo fora do documento, Fill zero com efeitos,
  opacidade local/export aplicada uma vez e fonte vetorial externa. Também
  compara região de mesclagem com o mesmo pixel do render pleno usando o
  backdrop real. Decode/Canvas de Node são doubles identificados.
- O oráculo real acrescenta **28 casos**: 18 de aparência e dez de mesclagem;
  **26 exigem Rust** e dois exigem fallback de transformação fracionária.
  Inclui os quatro tipos de forma, rotação, posição negativa/fracionária,
  imagem além da borda direita/inferior, sombras, alfa, Fill, fundo sintético,
  seis modos e canais de Blend If. Bounds e dimensões PNG precisam coincidir.
- Além disso, verifica fallback de minificação/texto e falha de encode com
  canvas liberado nos dois consumidores/backends. Mantém os três goldens,
  24 DCP3, 24 formas e provas editoriais/sessão anteriores intactos.
- Diagnóstico Wails acrescenta Blob real de aparência local/export fora do
  documento, mesclagem estilizada e forma isolada externa, exigindo backend Rust.

Ainda faltam texto/fontes, amostragem raster de alta qualidade/escalas,
miniaturas, smart content, preview interativo de Blend If, scheduler documental
incremental/cancelamento público/admission, C4 e QA/medições antes de retirar legado.

## 5. Validação local — 2026-10-19

- Frontend **608/608**, com seis casos editoriais novos, incluindo o gate de
  qualidade; typecheck do app/suítes passou. WASM/Worker **438/438**: **432**
  scripts, cinco standalone WASM e um standalone Worker, com três casos novos
  de aparência/mesclagem. O subconjunto de **33 testes** editoriais/sessão/novos
  consumidores passou três vezes e foi repetido após a guarda final de grade.
- Rust nativo **132/132**, `go test ./...`, build Vite, integridade do bundle
  e `git diff --check` passaram. ABI/algoritmos Rust não mudaram.
- Oráculo real passou com os **28 casos novos**: 26 Rust e dois fallbacks
  explícitos de transformação. Máximos de alfa/RGB premultiplicado: **1/2,46275**,
  dentro dos limites anteriores **2/3**. Bounds/dimensões, fallback de texto/
  minificação e limpeza em falha de encode dos dois backends passaram.
- Três goldens, 24 DCP3, 24 formas, documentos editoriais PNG/Blob/cor, reuso
  de sessão e descarte/reabertura por epoch permanecem passando sem regravar
  referências. Diagnóstico Wails validou os quatro Blobs adicionais reais.
- Smokes do preview normal, estilos Rust opt-in e fallback forçado passaram,
  com `lostActive=false`; caminho Rust manteve um Worker para três consumidores
  e zerou leases no cleanup. Texto/preview padrão permanecem preservados.
- Bundle mantém WASM `axia_pixel_core-BfefQY4S.wasm`, **124718 bytes**, e Worker
  `rustPixelPoc.worker-TnbjmuHD.js`, íntegros. Ambiente: Node **24.14.1**, Rust
  **1.98.1**, Go **1.26.5**, Windows **10.0.26200**, Edge **155.0.4283.45** e
  WebView2 **155.0.4283.62**.

Sem novo benchmark de FPS/RSS, validação manual, instalador/portável, mudança
de versão, ativação por padrão ou retirada de legado. O sampler afim não foi
corrigido nesta fatia: seus casos não equivalentes estão protegidos por fallback.
