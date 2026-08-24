# Roadmap de exportação de imagens e otimização

> Documento vivo para reestruturar a exportação final do Axia. Atualizar este
> arquivo na mesma alteração de código sempre que uma etapa avançar, mudar de
> escopo, encontrar um bloqueio ou for concluída.

## Metadados

- Criado em: 2026-08-24
- Última atualização: 2026-08-24
- Estado geral: prioridade ativa; medição e semântica de criação em andamento
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
| Fixtures e benchmark reprodutível | `EM ANDAMENTO` | Criar imagens sintéticas e medir o encoder atual |
| Contrato unificado de exportação | `NÃO INICIADO` | Definir tipos sem alterar ainda a UI |
| Semântica de pixels e DPI | `EM ANDAMENTO` | Expor tamanho físico na criação e depois gravar metadados na exportação |
| Importação e metadados de origem | `EM ANDAMENTO` | Completar JPEG EXIF e validar persistência/abertura de projeto |
| Otimização lossless de PNG | `NÃO INICIADO` | Comparar encoders e níveis de compressão |
| JPEG e WebP | `NÃO INICIADO` | Implementar após estabilizar o contrato |
| Diálogo e relatório de exportação | `NÃO INICIADO` | Integrar opções e estimativa |
| Persistência binária eficiente | `NÃO INICIADO` | Remover base64 do caminho principal |
| Validação Windows e Linux | `NÃO INICIADO` | Executar após integração completa |

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

Estado: `EM ANDAMENTO`

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

Estado: `NÃO INICIADO`

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

Estado: `NÃO INICIADO`

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

Estado: `NÃO INICIADO`

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

Estado: `NÃO INICIADO`

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

Estado: `NÃO INICIADO`

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
