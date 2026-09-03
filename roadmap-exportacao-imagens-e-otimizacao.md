# Roadmap de exportação de imagens e otimização

> Documento vivo para reestruturar a exportação final do Axia. Atualizar este
> arquivo na mesma alteração de código sempre que uma etapa avançar, mudar de
> escopo, encontrar um bloqueio ou for concluída.

## Metadados

- Criado em: 2026-08-24
- Última atualização: 2026-08-24
- Estado geral: implementação concluída e homologada no Windows; validação Linux e falhas ambientais pendentes
- Motivação: PNG de 1754 x 1240 px, 150 DPI e conteúdo fotográfico exportado com aproximadamente 1,49 MB
- Plataformas obrigatórias: Windows e Linux
- Stack atual: Go 1.23, Wails 2.12, Vue 3, TypeScript e Vite

## Objetivo

Transformar a exportação atual, limitada a um PNG produzido pelo encoder do
canvas, em um fluxo explícito, previsível e mensurável, com:

1. dimensões, resolução física, formato e qualidade apresentados sem ambiguidade;
2. PNG lossless correto e otimizado dentro de um orçamento aceitável de tempo;
3. formatos adequados para fotografia e web, sem forçar PNG em todos os casos;
4. preservação intencional de transparência e metadados de resolução;
5. estimativa e relatório do tamanho final;
6. testes de equivalência visual, desempenho, memória e persistência.

O objetivo não é prometer que todo PNG será menor que um valor arbitrário. O
tamanho lossless depende da entropia dos pixels. O objetivo é evitar trabalho e
bytes desnecessários, recomendar o formato apropriado e explicar ao usuário o
resultado antes de salvar.

## Conclusão da auditoria inicial

O caso relatado de 1,49 MB **não comprova sozinho um bug de compressão**.

- 1754 x 1240 contém 2.174.960 pixels.
- Um raster RGBA sem compressão ocupa aproximadamente 8,30 MiB; RGB, 6,22 MiB.
- Arquivos de origem de cerca de 90 KB podem ser JPEG ou WebP com perdas. Depois
  de decodificados, transformados e compostos, o PNG precisa armazenar o resultado
  lossless e não pode conservar a mesma relação de compressão das fontes.
- Fotografias, ruído, antialiasing, sombras e transparências comprimem pior em PNG
  que áreas grandes de cor chapada.
- Portanto, 1,49 MB é tecnicamente plausível para esse raster, embora possa haver
  ganho com outro formato ou encoder.

Foram encontradas lacunas reais que justificam a reestruturação:

1. A exportação final oferece apenas PNG.
2. `canvas.toBlob(..., 'image/png')` escolhe o encoder da WebView; não há controle
   de nível de compressão e o parâmetro de qualidade não se aplica a PNG.
3. O DPI do documento não é gravado explicitamente no PNG atual.
4. Quando a unidade do documento é `px`, mudar 300 para 150 DPI não reduz a
   quantidade de pixels. Isso é matematicamente correto, mas a interface precisa
   deixar claro que o DPI afeta o tamanho físico, não o peso de um raster com
   dimensões fixas em pixels.
5. Não há diálogo de exportação com formato, qualidade, fundo para transparência,
   dimensões finais, estimativa ou recomendação.
6. No desktop, o Blob é convertido em Data URL/base64, enviado pela ponte Wails,
   decodificado no Go e gravado sem nova otimização. Isso aumenta memória e cópias
   transitórias sem reduzir o arquivo.
7. Não existem fixtures e métricas de regressão para tamanho, tempo de codificação,
   memória ou fidelidade dos pixels exportados.

## Baseline de código confirmado em 2026-08-24

| Área | Arquivo atual | Comportamento confirmado |
| --- | --- | --- |
| Composição final | `frontend/src/services/renderDocument.ts` | Renderiza o documento em resolução integral e chama `canvas.toBlob` como PNG |
| Orquestração | `frontend/src/App.vue` | Aguarda as mutações, renderiza e encaminha o Blob ao salvamento |
| Ponte desktop | `frontend/src/services/backend.ts` | Converte o Blob PNG em Data URL/base64 |
| Persistência nativa | `app.go` | Valida, decodifica o base64 e grava os mesmos bytes |
| Dimensões | `frontend/src/editor/document.ts` | Em unidade `px`, o DPI não altera largura nem altura em pixels |
| Miniaturas | `frontend/src/services/renderDocument.ts` | Já usa WebP com qualidade 0,82 e fallback PNG; não é o fluxo de exportação final |

## Protocolo obrigatório de implementação

Antes de alterar código relacionado a este roadmap:

1. Ler este arquivo por completo.
2. Conferir `git status --short` e preservar alterações existentes.
3. Marcar a etapa como `EM ANDAMENTO` antes ou junto da primeira mudança material.
4. Registrar a baseline antes de tentar otimizar.
5. Separar mudanças de produto, encoder e persistência em incrementos testáveis.
6. Adicionar ou atualizar testes junto da mudança de comportamento.
7. Não adicionar biblioteca de imagem sem benchmark, análise de licença, impacto no
   binário e comparação com as opções nativas do navegador e do Go.
8. Atualizar este documento com arquivos alterados, decisões, resultados medidos,
   riscos restantes e próximo passo exato.

Estados permitidos: `NÃO INICIADO`, `EM ANDAMENTO`,
`IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`, `BLOQUEADO` e `CONCLUÍDO`.

## Estado atual

| Entrega | Estado | Próximo passo verificável |
| --- | --- | --- |
| Auditoria do fluxo atual | `CONCLUÍDO` | Preservar como baseline |
| Fixtures e benchmark reprodutível | `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO` | Repetir no Linux |
| Contrato unificado de exportação | `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO` | Validar integração no Linux |
| Semântica de pixels e DPI | `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO` | Validar DPI em leitor externo no Linux |
| Importação e metadados de origem | `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO` | Validar arquivos reais e abertura no teste de fogo |
| Otimização lossless de PNG | `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO` | Validar ganho e tempo com documento real no Windows/Linux |
| JPEG e WebP | `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO` | Validar qualidade, alpha e suporte real nas WebViews Windows/Linux |
| Diálogo e relatório de exportação | `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO` | Validar acessibilidade e comportamento no Linux |
| Persistência binária eficiente | `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO` | Validar falta de permissão/disco cheio e Linux |
| Validação Windows e Linux | `EM ANDAMENTO` | Windows homologado; executar roteiro no Linux |

## Princípios técnicos

1. Composição, codificação e persistência são responsabilidades separadas.
2. PNG continua lossless; uma opção chamada “qualidade” não deve fingir controlar
   perdas em PNG. Pode existir um perfil de esforço/velocidade de compressão.
3. JPEG e WebP com perdas devem apresentar qualidade explícita.
4. A fonte original das camadas deve ser usada na exportação, nunca previews.
5. A exportação não modifica documento, histórico, dirty state nem assets das camadas.
6. O fluxo respeita a `MutationBarrier` já usada pelo editor.
7. Transparência nunca pode ser descartada silenciosamente. JPEG exige uma cor de
   fundo escolhida ou confirmada.
8. Para documentos em pixels, DPI é resolução física/metadado; para unidades
   físicas, DPI participa da conversão para pixels.
9. O valor de DPI deve ser validado e convertido para pixels por metro quando o
   formato usar esse metadado: `round(dpi / 0,0254)`.
10. Otimizações PNG precisam preservar pixels exatamente; validar por decodificação
    e comparação dos canais, não apenas por inspeção visual.
11. Estimativas devem ser identificadas como estimativas. Quando possível, usar uma
    codificação reduzida ou amostra representativa, sem travar a interface.
12. Operações demoradas devem ser canceláveis e não bloquear a thread de interface.
13. Arquivos incompletos não podem substituir um destino válido.

## Fase 0 — Medição e reprodução

Estado: `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`

Criar fixtures determinísticas:

- cores chapadas, texto e vetores;
- transparência e gradientes suaves;
- fotografia ou ruído de alta entropia;
- composição mista equivalente ao relato, com 1754 x 1240 px;
- documento grande para medir pico de memória e cancelamento.

Para cada fixture, registrar dimensões, transparência, tamanho bruto estimado,
tamanho exportado, tempo de composição, tempo de codificação e plataforma. Também
inspecionar os chunks/metadados do PNG, incluindo presença e valor de `pHYs`.

Critérios de aceite:

- benchmark executável e repetível, sem depender de arquivos pessoais;
- baseline do encoder atual registrada neste documento;
- composição e codificação cronometradas separadamente;
- nenhuma meta absoluta de tamanho definida antes dos resultados.

## Fase 1 — Contrato e arquitetura de exportação

Estado: `EM ANDAMENTO`

Definir contratos semelhantes a:

- `ExportFormat`: `png`, `jpeg` e `webp`;
- `ExportSettings`: formato, qualidade quando aplicável, esforço PNG, dimensões,
  DPI, política de metadados e fundo para formatos sem alpha;
- `ExportResult`: Blob/stream, MIME, extensão, bytes, dimensões e duração;
- encoder independente do compositor e do destino de salvamento.

O renderizador deve entregar pixels corretos uma vez. Encoders diferentes devem
consumir o mesmo resultado, evitando três implementações de composição.

Critérios de aceite:

- o PNG padrão continua produzindo o mesmo conteúdo visual;
- erros e cancelamento têm contrato único;
- testes unitários cobrem normalização de extensão, MIME, qualidade e DPI;
- o caminho legado permanece disponível até a persistência nova estar validada.

## Fase 2 — Semântica de dimensões e DPI

Estado: `EM ANDAMENTO`

Revisar o diálogo de novo documento e o futuro diálogo de exportação para mostrar:

- dimensões finais em pixels e megapixels;
- tamanho físico resultante no DPI selecionado;
- explicação curta de que mudar DPI não reduz pixels quando a unidade é `px`;
- quando DPI será embutido como metadado e quando será ignorado pelo formato/leitor.

No PNG, gravar `pHYs` de forma determinística. Para JPEG e WebP, documentar e testar
a estratégia de metadados escolhida antes da implementação.

Critérios de aceite:

- 1754 x 1240 px continua 1754 x 1240 em 150 ou 300 DPI;
- o tamanho físico exibido muda corretamente;
- um PNG exportado pode ser reaberto/inspecionado com o DPI esperado;
- valores inválidos ou extremos são normalizados sem overflow.

## Fase 2A — Importação e metadados da imagem

Estado: `EM ANDAMENTO`

Preservar separadamente dimensões raster, tamanho comprimido da fonte e densidade
física informada pelo arquivo. Metadados de DPI não devem redimensionar uma camada
silenciosamente: a colocação padrão permanece 1:1 em pixels quando a imagem cabe no
documento e reduz proporcionalmente apenas quando precisa caber no canvas.

Fontes previstas:

- PNG: chunk `pHYs` quando a unidade for metro;
- JPEG: densidade JFIF e resolução EXIF quando válida;
- formatos sem densidade física: manter DPI ausente, sem inventar 72 ou 96;
- orientação EXIF continua aplicada às dimensões exibidas, independentemente do DPI.

Critérios de aceite:

- importação web e nativa produzem o mesmo modelo de metadados;
- `byteSize` representa o arquivo comprimido, não memória RGBA;
- DPI X e Y são preservados quando diferentes;
- metadados inválidos, ausentes ou extremos são ignorados com segurança;
- salvar e reabrir `.axia` preserva os metadados reconhecidos;
- nenhum metadado altera pixels ou transform sem ação explícita do usuário.

## Fase 3 — PNG lossless otimizado

Estado: `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`

Comparar, usando a Fase 0:

1. encoder PNG da WebView atual;
2. `image/png` do Go em níveis compatíveis;
3. encoder adicional somente se os ganhos justificarem dependência e manutenção.

Escolher um perfil padrão equilibrado e, se houver benefício real, expor
“mais rápido” e “menor arquivo”. Investigar PNG indexado/paleta apenas quando a
conversão for comprovadamente lossless para a imagem; não reduzir cores
silenciosamente.

Critérios de aceite:

- pixels e alpha idênticos à composição original;
- DPI escrito corretamente;
- nenhuma fixture fica maior sem justificativa registrada;
- tempo e memória permanecem dentro dos limites definidos após a baseline;
- resultado determinístico para a mesma entrada e configuração.

## Fase 4 — JPEG e WebP para fotografia e web

Estado: `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`

Adicionar formatos com perdas porque esse é o ganho mais relevante para documentos
fotográficos. Incluir qualidade, extensão correta e política explícita de alpha.

- JPEG: recomendado para fotografia opaca; exige achatar transparência contra uma
  cor selecionada.
- WebP: recomendado para web quando compatibilidade do destino permitir; testar
  modos com perdas e preservação de alpha.
- PNG: recomendado para transparência, interface, texto nítido e conteúdo que
  precisa permanecer lossless.

Critérios de aceite:

- MIME, assinatura e extensão sempre concordam;
- qualidade altera tamanho de forma previsível em fixtures fotográficas;
- exportação JPEG nunca transforma transparência em preto por acidente;
- dimensões finais não mudam entre formatos;
- interface apresenta uma recomendação, sem escolher com perdas silenciosamente.

## Fase 5 — Diálogo, estimativa e feedback

Estado: `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`

Criar um diálogo de exportação com formato, dimensões finais, DPI, qualidade/esforço,
transparência/fundo, estimativa de tamanho e resumo do uso recomendado. Depois de
salvar, informar caminho, tamanho real e duração; oferecer cancelamento durante
codificações demoradas.

Critérios de aceite:

- controles irrelevantes ficam ocultos ou desabilitados por formato;
- estimativa não é apresentada como tamanho garantido;
- configurações inválidas impedem confirmação com mensagem em português;
- teclado, foco e leitores de tela conseguem operar o diálogo;
- fechar ou cancelar não deixa Blob, URL ou operação órfã.

## Fase 6 — Persistência binária eficiente

Estado: `IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`

Substituir no desktop o transporte Blob -> Data URL/base64 -> Go por upload/stream
binário controlado, seguindo o padrão de endpoints locais já usado para outros
assets. Validar token de sessão, MIME, assinatura, limite de bytes e expiração.
Salvar inicialmente em arquivo temporário no mesmo volume e concluir com troca
segura, evitando destino parcialmente escrito.

Critérios de aceite:

- o caminho principal não cria uma cópia base64 do arquivo;
- cancelar ou falhar remove apenas o temporário criado pela exportação;
- nomes, extensões e sobrescrita seguem o diálogo nativo;
- endpoint não aceita token inválido, payload excessivo ou formato divergente;
- fallback web continua funcional.

## Validação obrigatória final

Automatizada:

- testes puros de dimensões físicas, DPI/pixels por metro e normalização de opções;
- parser mínimo de cabeçalhos/chunks para verificar formato, dimensões e metadados;
- comparação pixel a pixel dos PNGs lossless;
- testes de alpha e cor de fundo em JPEG/WebP;
- testes de erro, cancelamento, extensão e persistência;
- benchmark das fixtures com relatório versionável.

Manual no Windows e Linux:

- repetir o documento de 1754 x 1240 px em 150 e 300 DPI;
- exportar conteúdo chapado, fotográfico, misto e transparente;
- abrir os arquivos exportados em ao menos um visualizador externo;
- confirmar dimensões, DPI quando suportado, alpha e orientação;
- testar destino existente, cancelamento e falta de espaço/permissão;
- observar responsividade e pico de memória em documento grande.

Uma fase só pode ser marcada `CONCLUÍDO` quando seus testes automatizados passarem
e a validação manual exigida tiver sido registrada. Até lá usar
`IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`.

## Decisões iniciais

1. O relato será tratado como sinal de UX e arquitetura, não como prova de encoder
   defeituoso até existir uma fixture equivalente e benchmark.
2. Não comparar o tamanho final com a soma dos arquivos importados: são encodings e
   estágios diferentes do pipeline.
3. Não reduzir dimensões, cores ou qualidade silenciosamente para cumprir uma meta.
4. Não trocar o encoder PNG antes de comparar tamanho, tempo, memória e fidelidade.
5. Suporte a JPEG/WebP faz parte da solução; otimizar apenas deflate do PNG não
   resolve o caso geral de imagens fotográficas para web.

## Registro de evolução

### 2026-08-24 — Auditoria e criação

- Percorrido o fluxo de exportação desde a composição no frontend até a gravação no Go.
- Confirmado que o PNG final usa o encoder da WebView sem opção de compressão.
- Confirmado transporte desktop por Data URL/base64 e gravação sem reencode.
- Confirmado que DPI não altera dimensões de documentos definidos em pixels.
- Identificada ausência de metadado DPI explícito, múltiplos formatos, estimativa,
  benchmarks e contrato unificado.
- Criado este roadmap; nenhuma mudança funcional foi feita nesta etapa.

### 2026-08-24 — Início da implementação prioritária

- Roadmap de exportação elevado a prioridade; continuidade do roadmap de degradê pausada.
- Fase 0 iniciada para estabelecer fixtures e métricas antes da troca de encoder.
- Fase 2 iniciada pelo comportamento de criação: tamanho físico e efeito do PPI
  serão apresentados sem ambiguidade quando as dimensões forem informadas em pixels.
- Criada `documentPhysicalSize` em `frontend/src/editor/document.ts`, sempre derivada
  do raster final e do PPI, sem reamostrar pixels.
- O diálogo de novo documento agora informa o efeito do PPI conforme a unidade e
  exibe o tamanho físico calculado ao lado dos pixels e da memória base.
- Adicionados testes para o caso 1754 x 1240 em 150/300 PPI e para A4 horizontal
  criado em centímetros a 150 PPI.
- Arquivos alterados neste incremento: `frontend/src/editor/document.ts`,
  `frontend/src/components/NewDocumentDialog.vue`, `frontend/src/style.css`,
  `frontend/tests/document.test.mjs` e este roadmap.
- Validação automática pendente: o ambiente atual não disponibiliza `node`, `npm`
  ou `go` no PATH. `git diff --check` passou sem erros de whitespace; não marcar a
  Fase 2 como implementada até executar testes e build em ambiente com toolchain.
- Próximo passo exato: criar o modelo/parser testável de resolução das imagens
  importadas (PNG `pHYs` e JPEG JFIF/EXIF), preservando dimensões e orientação.

### 2026-08-24 — Metadados de resolução na importação

- Criado `frontend/src/editor/imageResolution.ts` para interpretar PNG `pHYs`,
  JPEG JFIF e JPEG EXIF com validação de unidade, limites e densidades X/Y.
- Quando JFIF e EXIF coexistem, EXIF válido tem precedência; metadado ausente ou
  inválido permanece ausente, sem assumir 72/96 PPI.
- Importação web agora lê cabeçalho uma única vez para dimensões e resolução,
  preserva `file.size` como tamanho comprimido e mantém o Blob original.
- Importação nativa agora retorna tamanho do arquivo e a mesma resolução física;
  a leitura é limitada aos primeiros 256 KiB e não decodifica o raster novamente.
- `ImportedImage` e `ImageAsset` passaram a preservar `byteSize`, DPI X/Y e fonte
  do metadado. `App.vue` copia esses dados sem alterar a transformação da camada.
- Persistência `.axia` grava e restaura os novos campos opcionais; projetos antigos
  continuam válidos e valores não reconhecidos são descartados na restauração.
- Testes adicionados em `frontend/tests/imageResolution.test.mjs`,
  `frontend/tests/project.test.mjs` e `app_test.go` para PNG, JFIF, EXIF e round-trip.
- Decisão de colocação registrada: importar em pixels 1:1 quando couber e reduzir
  somente para caber no documento; DPI não redimensiona silenciosamente.
- Validação automática continua pendente pela ausência de Node/npm/Go no PATH.
  `git diff --check` permanece sem erros de whitespace.
- Próximo passo exato: criar fixtures/relatório do encoder PNG atual e o contrato
  de opções de exportação antes de substituir qualquer encoder.

### 2026-08-24 — Contrato inicial e DPI no PNG exportado

- Confirmado commit `3fdc10c` como nova baseline limpa do repositório.
- Criado `frontend/src/editor/exportSettings.ts` com formatos PNG/JPEG/WebP,
  capacidades, MIME/extensão, qualidade, esforço PNG, fundo para formatos sem alpha
  e normalização defensiva de PPI.
- Criado `frontend/src/services/pngMetadata.ts`: insere ou substitui o chunk `pHYs`
  após `IHDR`, calcula CRC-32 e preserva todos os demais bytes sem decodificar ou
  recomprimir o raster.
- A exportação de documento em `App.vue` agora grava o PPI do documento no PNG
  antes do salvamento. O encoder e os pixels permanecem os mesmos nesta etapa.
- Adicionados testes puros para opções/extensões, conversão DPI -> pixels por metro,
  inserção/substituição de `pHYs` e rejeição de PNG inválido/truncado.
- Arquivos criados: `frontend/src/editor/exportSettings.ts`,
  `frontend/src/services/pngMetadata.ts`, `frontend/tests/exportSettings.test.mjs` e
  `frontend/tests/pngMetadata.test.mjs`. Arquivo integrado: `frontend/src/App.vue`.
- `git diff --check` passou. Testes/build continuam pendentes porque Node/npm/Go
  seguem indisponíveis no PATH desta sessão.
- Próximo passo exato: criar o diálogo de exportação e o encoder comum para expor
  PNG/JPEG/WebP com transparência e qualidade explícitas.

### 2026-08-24 — Diálogo e exportação PNG/JPEG/WebP

- Criado `frontend/src/components/ExportImageDialog.vue` com formato, qualidade,
  cor de fundo JPEG, pixels finais, memória raster, transparência e informação de PPI.
- A interface distingue memória RGBA de tamanho no disco e não apresenta estimativa
  comprimida como garantia antes de existir medição representativa.
- `renderDocumentExportBlob` reutiliza uma única composição para os três formatos.
  JPEG com documento transparente recebe matte explícito antes da codificação.
- PNG preserva alpha e recebe `pHYs`; WebP preserva alpha quando suportado; JPEG não
  suporta alpha e a interface informa o achatamento antes de exportar.
- A resposta do encoder é validada por MIME para impedir arquivo com extensão falsa
  quando uma WebView não suporta o formato solicitado.
- Criado `saveExportedImageBlob`; o fallback web usa Blob URL e extensão normalizada.
- Backend Go ganhou `SaveExportedImage` com lista fechada de MIME/extensão/filtro,
  validação da assinatura detectada e diálogo nativo específico. `SaveExportedPNG`
  permanece como wrapper compatível para exportação de camada e chamadas legadas.
- Bindings Wails locais foram atualizados para permitir build antes de uma futura
  regeneração automática com a toolchain disponível.
- Menu passou de “Exportar como PNG” para “Exportar imagem…”. O diálogo participa
  de `modalOpen`, bloqueando atalhos e interações do editor enquanto estiver aberto.
- Após salvar, a barra de status informa formato, tamanho real em MB e caminho.
- Arquivos criados/alterados: `frontend/src/components/ExportImageDialog.vue`,
  `frontend/src/services/renderDocument.ts`, `frontend/src/services/backend.ts`,
  `frontend/src/App.vue`, `frontend/src/components/TopMenu.vue`, `frontend/src/style.css`,
  `frontend/wailsjs/go/main/App.js`, `frontend/wailsjs/go/main/App.d.ts`, `app.go` e este roadmap.
- Limitações conscientes: JPEG/WebP ainda não recebem metadado físico; o diálogo
  declara isso. PNG ainda usa compressão da WebView; esforço PNG será conectado
  somente após benchmark. Transporte desktop ainda usa base64 até a Fase 6.
- `git diff --check` passou; testes/build seguem pendentes por toolchain ausente.
- Próximo passo exato: implementar persistência binária com token temporário e
  remover base64 do caminho principal antes dos benchmarks finais.

### 2026-08-24 — Transporte binário e gravação segura

- Criado `export_upload.go` com preparação do diálogo nativo, token aleatório de
  uso único, validade de dois minutos e associação fechada entre destino e MIME.
- O frontend chama `PrepareExportedImage` e envia o Blob diretamente por `fetch`
  para `/__axia_export/save/{token}`; nenhuma Data URL ou cópia base64 é criada no
  caminho principal de exportação de documento.
- Endpoint aceita somente POST, token seguro/não expirado e `Content-Type` idêntico
  ao formato reservado. O token é consumido inclusive em tentativa inválida.
- Upload limitado a 512 MiB; depois da escrita o backend valida assinatura/formato,
  dimensões máximas e limite de 64 megapixels com `image.DecodeConfig`.
- A gravação usa temporário no mesmo diretório, `Sync`, fechamento e
  `replaceFileAtomically`; falhas removem o temporário e preservam o destino anterior.
- Middleware, ciclo de shutdown e bindings Wails foram atualizados. O método antigo
  por base64 permanece apenas para compatibilidade com exportação legada de camada.
- Criado `export_upload_test.go` cobrindo upload binário, consumo único do token,
  divergência de MIME e preservação de arquivo existente em falha.
- Arquivos criados/alterados nesta etapa: `export_upload.go`, `export_upload_test.go`,
  `app.go`, `frontend/src/services/backend.ts`, `frontend/wailsjs/go/main/App.js`,
  `frontend/wailsjs/go/main/App.d.ts`, `frontend/wailsjs/go/models.ts` e este roadmap.
- `git diff --check` passou. Execução dos testes/build permanece pendente porque a
  toolchain Node/npm/Go não está disponível no PATH desta sessão.
- Próximo passo exato: implementar fixtures de conteúdo e benchmark comparativo do
  PNG da WebView contra `image/png` do Go antes de escolher compressão padrão.

### 2026-08-24 — Toolchain recuperada, correções e build Windows

- Como Node e Go não estavam instalados no PATH, foram usadas toolchains portáteis
  em `%TEMP%`: Node.js 22.22.0 e Go 1.23.12, sem instalação permanente no sistema.
- Primeira execução frontend encontrou cinco falhas: imports sem extensão `.ts` em
  dois módulos novos e ausência dos campos de resolução ao criar `storedImage` no
  manifesto `.axia`.
- Corrigidos `frontend/src/services/pngMetadata.ts`,
  `frontend/src/services/imageImport.ts` e `frontend/src/services/project.ts`.
- Resultado final frontend: 222 testes aprovados, zero falhas.
- `vue-tsc --noEmit` e build Vite de produção aprovados.
- `gofmt` aplicado a `app.go`, `export_upload.go` e `export_upload_test.go`.
- Resultado final Go: `go test ./...` aprovado.
- Wails CLI 2.12.0 executado pelo módulo oficial; bindings regenerados durante o
  build, substituindo as alterações manuais provisórias.
- Build Wails Windows/amd64 aprovado em modo production. Artefato gerado em
  `build/bin/axia.exe`, com 12.013.056 bytes.
- `git diff --check` voltou a passar após remover whitespace residual introduzido
  pelo gerador no trecho novo de `frontend/wailsjs/go/models.ts`.
- Validação automatizada Windows está aprovada. Permanecem benchmark, teste manual
  Windows e validação equivalente em Linux antes de marcar as fases como concluídas.
- Próximo passo exato: executar benchmarks das fixtures PNG e depois o teste de fogo
  do diálogo, PNG/JPEG/WebP, transparência, DPI e sobrescrita no executável gerado.

### 2026-08-24 — Benchmark PNG reproduzível no Windows

Ambiente medido: Windows/amd64, Intel Core i7-3770 3,40 GHz, Go 1.23.12 e
Microsoft Edge/Chromium instalado no sistema. Todas as fixtures usam 1754 x 1240 px,
RGBA opaco e exatamente os mesmos pixels nos dois runtimes. Cada tempo é a média de
três codificações; valores são baseline desta máquina, não promessa universal.

| Fixture | Canvas bytes / tempo | Go BestSpeed bytes / tempo | Go Default bytes / tempo | Go BestCompression bytes / tempo |
| --- | ---: | ---: | ---: | ---: |
| Cor chapada | 46.819 / 32,0 ms | 11.279 / 26,3 ms | 9.199 / 75,2 ms | 9.195 / 71,3 ms |
| Gradiente | 66.912 / 32,6 ms | 38.209 / 89,8 ms | 9.510 / 108,0 ms | 8.743 / 122,6 ms |
| Ruído fotográfico | 7.435.366 / 151,2 ms | 6.529.076 / 277,4 ms | 6.530.201 / 417,0 ms | 6.530.201 / 450,0 ms |
| Conteúdo misto | 2.362.759 / 63,5 ms | 2.052.590 / 133,7 ms | 2.046.038 / 186,6 ms | 2.042.505 / 259,2 ms |

Conclusões:

- Go `BestSpeed` foi menor que Canvas em todas as fixtures: aproximadamente 75,9%
  em cor chapada, 42,9% em gradiente, 12,2% em ruído e 13,1% no conteúdo misto.
- `DefaultCompression` melhora muito gráficos simples, mas no misto economiza apenas
  mais 6.552 bytes que `BestSpeed` ao custo de cerca de 52,9 ms adicionais.
- `BestCompression` não traz ganho relevante para fotografia/misto; no misto reduz
  só 3.533 bytes frente ao padrão e aumenta o tempo em cerca de 72,6 ms.
- Para o relato original de 1,49 MB, uma distribuição semelhante à fixture mista
  sugere ganho lossless da ordem de 13%, não redução para perto dos 180 KB das fontes.
  JPEG/WebP continuam sendo a solução de maior impacto para conteúdo fotográfico web.
- Decisão: não usar `BestCompression` como padrão. O candidato equilibrado para uma
  etapa nativa lossless é `BestSpeed`; `DefaultCompression` pode ser o perfil
  “menor arquivo” para gráficos, sempre opcional e medido após incluir decode/upload.

Infraestrutura criada:

- `export_png_benchmark_test.go`: fixtures determinísticas e benchmark dos níveis Go.
- `frontend/benchmarks/pngCanvasEncoder.html`: mesma geração de pixels e medição do
  encoder Canvas/Chromium, executável em Edge headless.
- Comando Go: `go test -run '^$' -bench '^BenchmarkPNGEncoders$' -benchtime=3x -benchmem`.
- O benchmark não altera o comportamento de produção.
- Próximo passo exato: decidir se o perfil PNG padrão será reencodado em Go BestSpeed
  ou se a otimização nativa ficará opt-in; medir também o custo total decode+encode.

### 2026-08-24 — Revisão de linguagem e fluxo após copiar seleção

- Feedback de uso identificou linguagem excessivamente técnica no diálogo de
  exportação. Removidos termos como “raster RGBA”, “alpha” e explicações internas.
- Formatos agora são apresentados pelo resultado esperado: PNG para nitidez e
  transparência, JPEG menor para fotos e WebP menor para sites.
- O diálogo explica em frases curtas o benefício e a limitação do formato ativo,
  usa “pixels por polegada” em vez de apenas PPI e informa que o tamanho final será
  mostrado depois de salvar.
- A mensagem de transparência JPEG permanece explícita e a escolha da cor de fundo
  continua obrigatória quando o documento possui fundo transparente.
- Esclarecida a semântica de `Ctrl+J`: é “camada via cópia”, portanto os pixels da
  camada original devem permanecer. Um verdadeiro “via corte” seria uma ação futura
  separada, não uma mudança silenciosa no atalho existente.
- Depois de copiar uma área selecionada para nova camada, o editor agora limpa a
  seleção, ativa `Mover (V)` e deixa a nova camada ativa/pronta para posicionamento.
- O delta `layers:add` passou a poder carregar `selectionBefore/selectionAfter`;
  desfazer restaura a seleção original e refazer volta a removê-la.
- Arquivos alterados: `frontend/src/components/ExportImageDialog.vue`,
  `frontend/src/style.css`, `frontend/src/App.vue`,
  `frontend/src/editor/editorHistory.ts` e este roadmap.
- Validação: 222 testes frontend aprovados; `vue-tsc --noEmit` e build Vite aprovados.
- Próximo passo exato: validar manualmente `Ctrl+J`, undo/redo e a compreensão do
  diálogo no executável Windows; depois decidir se “camada via corte” será adicionada.

### 2026-08-24 — Otimização PNG condicional (“nunca piorar”)

- Adicionado benchmark do custo total `decode + encode BestSpeed`. Nas fixtures
  chapada/gradiente/ruído/mista foram medidos aproximadamente 42,5 / 109,0 / 297,5 /
  230,5 ms respectivamente nesta máquina.
- O teste revelou que recodificar um PNG já produzido por `DefaultCompression` pode
  aumentá-lo: misto foi de 2.046.038 para 2.052.590 bytes; cor chapada, de 9.199 para
  11.279 bytes. Portanto, reencode incondicional foi formalmente rejeitado.
- `storeExportUpload` agora, somente para PNG, gera candidato Go `BestSpeed`, compara
  os bytes e conserva o original sempre que o candidato não for estritamente menor.
- A otimização ocorre no temporário antes da troca atômica; erro de decode/encode não
  substitui o destino e remove os temporários envolvidos.
- O chunk `pHYs` original é copiado byte a byte para o candidato otimizado, incluindo
  unidade, densidades X/Y e CRC. Os pixels não são alterados.
- JPEG e WebP não passam por recodificação nativa.
- Teste automatizado novo cobre PNG propositalmente pouco comprimido, redução real,
  preservação de `pHYs`, dimensões e amostras de pixels. Testes Go completos passaram.
- Decisão final: perfil automático `BestSpeed` com seleção pelo menor resultado;
  `DefaultCompression`/`BestCompression` não entram no fluxo padrão.
- Arquivos alterados: `export_upload.go`, `export_upload_test.go`,
  `export_png_benchmark_test.go` e este roadmap.
- Próximo passo exato: reconstruir o executável e validar tamanho/tempo com o arquivo
  real de 1754 x 1240; depois implementar estimativa amigável no diálogo.

### 2026-08-24 — Exportação de camada alinhada ao fluxo seguro

- A exportação rápida de uma camada deixou de enviar o PNG como texto base64 e agora
  usa o mesmo transporte binário temporário, validado e de uso único do documento.
- O PNG isolado da camada recebe o `pHYs` correspondente à resolução do documento,
  preservando a informação de DPI também nesse caminho de exportação.
- Como passa pelo fluxo binário comum, a camada também recebe automaticamente a
  otimização PNG condicional “nunca piorar” antes da gravação atômica.
- Arquivo alterado: `frontend/src/App.vue` e este roadmap.
- Próximo passo exato: validar testes/build e implementar uma medição de tamanho sob
  demanda no diálogo, reutilizando o arquivo já codificado ao confirmar a exportação.

### 2026-08-24 — Tamanho calculado antes de salvar

- O diálogo ganhou a ação simples “Calcular tamanho do arquivo”; o cálculo só ocorre
  quando solicitado para não recodificar imagens grandes a cada movimento do controle.
- O valor exibido vem do arquivo realmente renderizado com formato, qualidade e fundo
  escolhidos, em vez de uma fórmula baseada apenas na quantidade de pixels.
- Para PNG a interface avisa que o arquivo ainda pode ficar um pouco menor, pois a
  otimização nativa condicional acontece depois do envio binário.
- O blob calculado fica em cache e é reutilizado se o usuário exportar sem mudar as
  opções, evitando uma segunda composição/codificação completa.
- Qualquer alteração de formato, qualidade ou fundo invalida imediatamente a medição;
  resultados assíncronos antigos também não podem substituir uma medição mais nova.
- Durante o cálculo os controles ficam bloqueados e mostram “Calculando…”, distinguindo
  esse estado da gravação final “Exportando…”.
- Arquivos alterados: `frontend/src/App.vue`,
  `frontend/src/components/ExportImageDialog.vue`, `frontend/src/style.css` e roadmap.
- Validação final: 222 testes frontend, `vue-tsc --noEmit`, build Vite e testes Go
  passaram. O executável Windows/amd64 foi reconstruído com Wails 2.12.0 em
  `build/bin/axia.exe` (12.021.248 bytes).
- Próximo passo exato: teste de fogo com o documento real; comparar PNG, JPEG e WebP,
  conferir o tamanho calculado e registrar qualquer diferença percebida na prática.

### 2026-08-24 — Instalador para validação prática

- Aplicativo e instalador Windows/amd64 reconstruídos em modo de produção com Wails
  2.12.0 e NSIS.
- Instalador atualizado em `build/bin/axia-amd64-installer.exe`, com 6.794.546 bytes.
- SHA-256 do instalador:
  `E9D2C53255681D4FFFBE12C73E7904961AD7E4F8C8D34736A69A49BDAB63D104`.
- Esta é uma build de validação local; o roteiro prático deve cobrir criação em pixels
  com DPI, importação, Ctrl+J, exportação nos três formatos e exportação de camada.

### 2026-08-24 — Proporção vinculada no novo documento

- Adicionada a opção “Manter proporção entre largura e altura”, ativada por padrão.
- Ao editar a largura, a altura é recalculada pela proporção vigente; editar a altura
  recalcula a largura pelo mesmo critério.
- Ligar a opção captura as dimensões atuais como nova proporção. Assim, o usuário pode
  desligar, definir livremente um formato e religar para escalá-lo.
- Aplicar uma predefinição, como A4, passa a capturar a proporção dessa predefinição;
  trocar a orientação ou a unidade também atualiza a referência corretamente.
- Pixels são arredondados para inteiros; unidades físicas mantêm a precisão usada pelo
  diálogo. Valores temporariamente vazios ou inválidos não contaminam o outro campo.
- A matemática foi isolada em `frontend/src/editor/document.ts` para receber testes
  automatizados nas duas direções e para entradas inválidas.
- Arquivos alterados: `frontend/src/components/NewDocumentDialog.vue`,
  `frontend/src/editor/document.ts`, `frontend/tests/document.test.mjs`,
  `frontend/src/style.css` e este roadmap.
- Validação: 224 testes frontend, `vue-tsc --noEmit` e build Vite passaram; o
  instalador Windows foi reconstruído após a mudança.

### 2026-08-24 — Homologação prática do fluxo no Windows

- O usuário validou o fluxo completo de criação, edição e exportação no instalador
  Windows e confirmou que o comportamento corresponde ao esperado.
- PNG, JPEG e WebP foram exportados e abertos com sucesso no visualizador de imagens
  do Windows, com resultado visual aprovado.
- O cancelamento da janela nativa de salvamento e a sobrescrita de arquivo existente
  foram exercitados com sucesso.
- Foi realizado teste exploratório/de estresse, tentando provocar falhas por diferentes
  interações; nenhuma instabilidade ou bug foi observado nesta rodada.
- Não foram registrados números do documento real. Isso não invalida a homologação
  funcional: as métricas reproduzíveis permanecem cobertas pelas fixtures versionadas.
- Pendências formais restantes: executar a validação no Linux e, quando houver ambiente
  seguro para isso, verificar erro de pasta sem permissão e falta de espaço em disco.
- Estado da entrega: desenvolvimento concluído; homologação multiplataforma ainda em
  andamento conforme os critérios originalmente definidos neste roadmap.

### 2026-09-03 — Correção da mesclagem de camadas raster

- Investigado o erro `Não foi possível carregar a prévia` ao mesclar duas fotos.
- A prévia da camada mesclada agora é preparada enquanto as camadas originais ainda
  pertencem ao documento; só depois ocorre a substituição atômica e o registro no histórico.
- Eliminada a disputa entre a geração explícita da prévia e a atualização disparada
  pela troca da camada ativa.
- Referências nativas de imagens deixam de ser liberadas durante estados transitórios;
  permanecem disponíveis para composição e `Ctrl+Z` até o documento ser fechado.
- Importações que falham antes de serem adotadas continuam liberando seus recursos
  imediatamente, evitando acumular referências sem uso.
- O compositor passou a decodificar, desenhar e liberar uma camada de cada vez, em vez
  de manter simultaneamente em memória os rasters originais de todas as fotos.
- O desenho e a ordem de composição não mudam; a alteração reduz apenas o pico de
  memória e torna uma eventual falha identificável pelo nome exato da camada.
- Validação: 347 testes frontend, `vue-tsc --noEmit`, bundle Vite 8, testes Go e
  `git diff --check` aprovados.
- Executável atualizado em `bin/axia.exe` (13.483.520 bytes; SHA-256
  `9A3FE3A944E611F5327F6E93A46787001910C6621EB8D846CF01921E82580A83`).
- Instalador NSIS da correção atualizado em `bin/axia-amd64-installer.exe`
  (7.321.281 bytes; SHA-256
  `166EE38E74EB414D67AE38DC38628C67D6289F878A12980775F339E8037CD732`).
