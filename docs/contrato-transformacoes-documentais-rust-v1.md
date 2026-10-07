# Transformações documentais e ABI DCP2 — C3, fatia 3

Estado: implementado no núcleo Rust, ABI WASM, encoder/runtime TypeScript e
Worker experimental. DCP1 continua aceito, sem alteração de layout ou resultado.
Preview normal, exportação, texto e `renderDocument.ts` continuam nos caminhos
atuais. Não encerra C3 nem habilita o canvas único C4.

Relacionado à [pilha inicial](contrato-pilha-documental-rust-v1.md),
[ABI DCP1](contrato-abi-pilha-documental-rust-v1.md),
[contrato lógico](contrato-compositor-v1.md) e
[roadmap](roadmap-compositor-rust-internacionalizacao.md).

## 1. Coordenadas e transformação

O mesmo `compose_document_region` recebe `output_grid: Option<DocumentOutputGrid>`
e cada `DocumentRasterLayer` pode receber `transform: Option<DocumentAffine>`.
Sem grade, o caminho inteiro original permanece. Com grade, usa o amostrador
afim de `document_transform.rs`. A fonte continua RGBA8 compacta, alfa reto;
a transformação não altera o buffer de origem.

Matriz fonte → documento `[a, b, c, d, tx, ty]`:

```text
documentX = a * sourceX + c * sourceY + tx
documentY = b * sourceX + d * sourceY + ty
outputX = (documentX - originX) * scaleX
outputY = (documentY - originY) * scaleY
```

As coordenadas descrevem bordas de pixels, não centros. A fonte ocupa
`[0, width] × [0, height]`; seu centro de texel `(i, j)` fica em `(i+.5, j+.5)`.
O documento ocupa `[0, documentWidth] × [0, documentHeight]`; a geometria é
recortada ao documento antes da composição. Não há projeção/perspectiva.

`region` passa a identificar pixels **globais de saída**, sem negativos.
O pixel `(x, y)` é amostrado no centro global `(x+.5, y+.5)`, invertendo grade
e transformação, independentemente da origem do tile. Não acumular incrementos
flutuantes a partir do início de um tile: isso altera arredondamentos e cria
emendas. `originX/Y` são coordenadas documentais, podendo ser fracionárias ou
negativas; não são a origem local da região.

`resolution_scale` permanece exatamente `1` no núcleo/objeto TS. Em DCP2,
escala de saída pertence exclusivamente a `outputGrid`; não aplicar a escala
duas vezes. No encoder DCP2, toda camada exige `sourceToDocument`, com `x=y=0`.
O núcleo nativo também permite uma grade com camada sem matriz, usando sua
translação inteira. Matriz explícita junto de `x/y` não zero é rejeitada.

## 2. Reamostragem, cobertura e arredondamento

1. Intersectar bounds da camada transformada, documento transformado e região.
2. Inverter o centro global de cada pixel para coordenadas da fonte.
3. Interpolar os quatro texels vizinhos com alfa premultiplicado. Prender os
   centros de amostragem à fonte, sem ler fora do buffer. RGB de texel com
   alfa zero não deve contaminar uma borda semitransparente.
4. Calcular separadamente a cobertura geométrica: área do quadrilátero afim
   recortado ao pixel e ao documento. Pixels inteiramente interiores usam
   cobertura `1`, sem executar o recorte poligonal.
5. Despremultiplicar a cor uma vez e multiplicar alfa por cobertura e opacidade
   fracionária. Usar o mesmo blend da pilha original e quantizar somente ao
   publicar o resultado RGBA do pixel. Alfa publicado zero implica RGB zero.

O recorte usa dois arrays fixos de pontos na stack, sem alocação por pixel.
A área é calculada em coordenadas locais do pixel para reduzir cancelamento
numérico em origens globais grandes. Separar cobertura de filtragem evita que
uma fonte opaca ampliada perca alfa nas bordas externas.

O filtro é **bilinear pontual**, não um filtro de área para redução intensa
ou anisotrópica. A cobertura integra a geometria, não a textura inteira dentro
do pixel. Qualidade de minificação, comparação tolerante com Canvas 2D e
políticas de qualidade por consumidor ainda são gates antes da integração.
Não promete ICC, luz linear, igualdade byte a byte com Canvas/GPU ou mudança
na nitidez do texto do usuário nesta entrega.

## 3. Layout binário DCP2

Todos os inteiros e `f64` são little-endian. Header de 80 bytes; record de
80 bytes por camada, na ordem inferior → superior. RGBA de todas as fontes
vem depois dos records, contíguo, sem padding, aliases ou bytes finais.
Os offsets de fonte são relativos ao início do pacote, nunca ponteiros WASM.

| Offset no header | Tipo | Campo |
| --- | --- | --- |
| 0 | 4 bytes | ASCII `DCP2` |
| 4 | u32 | versão `2` |
| 8 | u32 | tamanho de header `80` |
| 12 | u32 | número de camadas |
| 16 / 20 | u32 | largura / altura do documento |
| 24 / 28 | u32 | X / Y global da região de saída |
| 32 / 36 | u32 | largura / altura da região |
| 40 / 48 | f64 | `scaleX` / `scaleY` |
| 56 / 64 | f64 | `originX` / `originY` |
| 72–79 | 8 bytes | reservados, obrigatoriamente zero |

| Offset no record | Tipo | Campo |
| --- | --- | --- |
| 0 / 4 | u32 | offset / comprimento da fonte |
| 8 / 12 | u32 | largura / altura da fonte |
| 16 | u32 | visível: `0` ou `1` |
| 20 | u32 | blend `0..5`, mesmas variantes de DCP1 |
| 24 | f64 | opacidade `[0, 100]` |
| 32 / 40 / 48 / 56 / 64 / 72 | f64 | `a / b / c / d / tx / ty` |

O export `axia_poc_document_region(packetPtr, packetLen, outputPtr, outputLen)`
permanece com quatro argumentos e aceita DCP1 ou DCP2. O novo export sem
argumentos `axia_poc_document_packet_version()` retorna `2`; o runtime exige
essa capacidade antes de enviar DCP2. WASM anterior sem a consulta continua
usável por estilos/DCP1, mas DCP2 retorna `wasm-unavailable`, sem alocar.

No Worker, mantém-se `compose-document-region` → `rendered-document-region`.
Pacote pode ser transferido; saída é cópia RGBA própria e transferível. Região
de resposta está no espaço global de saída. Timings e cleanup seguem DCP1.
Nenhuma fonte staged é substituída pela composição documental.

## 4. Limites e rejeição transacional

- Fontes/saída: eixos de até `16384`, cada raster de até `64 MiB`.
- Pacote de até `64 MiB`, até `1024` camadas. Pacote + saída + reserva de
  `128 bytes` por descritor deve caber em `96 MiB`; a fonte staged residente
  também é somada pelo runtime. Não é medição de RSS nem budget entre janelas.
- `scaleX/Y` finitos entre `1/1024` e `128`; origens finitas com valor absoluto
  até `u32::MAX`. Documento e endpoints da região mantêm os limites de DCP1.
- `a/b/c/d` finitos, módulo até `1e6`; `tx/ty` finitos, módulo até `u32::MAX`.
  Determinante finito, módulo pelo menos `1e-12`; coeficientes da base inversa
  finitos, módulo até `1e6`. Espelhamento é permitido; matriz singular não.
- Trabalho transformado por pedido: soma das áreas dos bounds intersectados
  das camadas visíveis com opacidade positiva, até `16 * 1024 * 1024` pixels.
  Cada amostra usa até quatro texels. É quota conservadora de trabalho, não
  prazo de execução ou FPS garantido; camadas finas rotacionadas também contam
  seu bounding box. O futuro scheduler poderá dividir pedidos em tiles menores.

Todas as camadas, inclusive ocultas e fora da região, passam pela validação de
fonte, matriz e opacidade. Rejeição ocorre antes de limpar/escrever a saída.
O encoder verifica limites antes de criar o pacote; o runtime repete preflight
antes de alocar no WASM, e Rust valida novamente antes de processar pixels.

Status `7` significa quota de trabalho excedida, mapeada para `work-limit` no
runtime/protocolo. Não confundir com status `6`/`memory-limit`. Demais statuses,
validade dos pares do allocator e proibição de overlap seguem DCP1. O teste de
metadata verifica que o descritor nativo cabe na reserva; não constitui uma
contabilidade física completa de heap, stack, Worker ou cópias JS.

## 5. Provas e próximos gates

Goldens nativos e WASM cobrem identidade, translação fracionária, rotação,
espelhamento, redução simples, escala não uniforme, pan, cobertura na borda
documental, fontes opacas ampliadas e RGB oculto em texels transparentes.
Tiles de 1, 2, 3 e 7 pixels comparam byte a byte com o render inteiro, também
em shear/rotação e nos seis modos. Testes rejeitam matriz/grade inválidas,
campos reservados, quota excedida e capacidade WASM ausente; Worker real
transfere resultado e se recupera de pedido inválido.

Ainda faltam integrar estilos/Fill e seus halos/insets, `Blend If` subjacente,
preparação/reuso de fontes, orçamento/admission/scheduler documental e um
consumidor offscreen atrás de flag. Texto/shaping permanecem no navegador.
Não substituir uploads integrais por tile no preview sem essa preparação.
QA de arquivos reais e rollout continuam pendentes; nenhum legado foi removido.

## 6. Validação local — 2026-10-07

- Rust nativo: `cargo test --offline --locked` passou **98** testes. Os **37**
  casos documentais também passaram em `--release`; `cargo fmt --check` passou.
- Frontend: `npm test` passou **587** testes e o typecheck das suítes.
- `npm run test:rust-poc`: **384** casos, sendo cinco standalone WASM, um
  standalone Worker e **378** scripts. Os **18** casos DCP1/DCP2 passaram em
  outras três execuções consecutivas. Não são benchmark.
- Build Vue/TypeScript/Vite e `test:rust-bundle` passaram. Asset WASM
  `axia_pixel_core-vIqzdDiG.wasm`, **113916 bytes**, íntegro contra o Cargo;
  Worker `rustPixelPoc.worker-Pt-X7A0g.js`. O aviso de chunk acima de 500 kB
  permanece, sem falha de build.
- `go test ./...` passou. Diagnóstico Wails/WebView2 real executou DCP1 e
  DCP2 do bundle incorporado; preview normal, estilos Rust opt-in e fallback
  forçado passaram, incluindo cleanup e isolamento multicamadas.
- Ambiente: Node **24.14.1**, Rust **1.98.1**, Go **1.26.5**, Windows
  **10.0.26200**, WebView2/Edge **154.0.4258.62**, DPR **1**, i7-3770.

Isso comprova os casos automatizados locais, não QA manual, matriz de outros
WebViews/hardware ou ganho de FPS. Executáveis temporários dos smokes foram
limpos pelo harness; não foi gerado instalador/portável de distribuição.
