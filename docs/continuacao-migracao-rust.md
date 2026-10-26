# Continuação da migração Rust — estado em 2026-10-26

Anotação para retomar o trabalho em outra máquina. Detalhes técnicos de cada
decisão ficam nos contratos em `docs/`, principalmente
`contrato-reamostragem-raster-rust-v1.md` (seções 5.2 e 6.1) e
`contrato-texto-documental-rust-v1.md`.

## 1. Situação desta fatia (redução de imagem)

O código está pronto, mas **ainda não está commitado e a bateria completa ainda
não rodou** depois das últimas mudanças. Antes de trocar de máquina é preciso
commitar e enviar a partir da máquina original; o commit anterior (`61b999b`)
também ainda não foi enviado (`main` 1 à frente de `origin/main` no momento da
anotação).

### Já validado

- `cargo test` 146/146, `cargo clippy -- -D warnings` e `cargo fmt --check`.
- Typecheck (`vue-tsc`).
- Planner (`tests/rustDocumentEditorial.test.ts`) 19/19.
- DCP4 (`scripts/tests/rustDocumentSampling.test.ts`) 8/8.
- Área (`scripts/tests/rustRasterArea.test.ts`) 2/2, com 192 casos idênticos
  byte a byte à referência independente.
- Paridade (`scripts/tests/rustRasterParity.test.ts`) 3/3.

### Falta rodar antes de commitar

```powershell
cd frontend
npm.cmd test
npm.cmd run test:rust-poc
npm.cmd run build
npm.cmd run test:rust-bundle
npm.cmd run smoke:document-oracle      # a sentinela de redução da aparência mudou
npm.cmd run smoke:document-resampling
npm.cmd run smoke:rust-wails           # precisa do Go no PATH
cd ..
git diff --check
```

Se o `smoke:rust-wails` falhar com "DevTools WebView2 não respondeu", repita: é
fragilidade do script sob carga da máquina (limite de 5 s por chamada DevTools),
não regressão. Só trate como defeito se repetir com a máquina ociosa.

Também falta a entrada desta fatia no
`roadmap-compositor-rust-internacionalizacao.md`; a seção 6.1 do contrato de
reamostragem serve de base.

### Mensagem de commit sugerida

Sem linha de co-autor.

```
feat(renderer): compose reduced rasters in Rust with bilinear and exact area sampling / compõe rasters reduzidos em Rust com bilinear e média de área exata

Redução de imagem deixava o documento inteiro em fallback
(source-minification). Uma gravação do Canvas real (1.152 casos por
ambiente) mostrou que não há alvo único: o WebView2 distribuído
(Chromium 155) usa bilinear em toda a faixa, enquanto o Chromium 156 e o
contexto GPU passam a usar mipmap abaixo de ~0,53.

- Escalas >= 0,5 usam os modos bilineares existentes, que casam
  estritamente com o WebView2 distribuído; o mínimo deixou de ser 1.
- Abaixo de 0,5, onde o bilinear pula texels e gera aliasing, o novo
  DocumentSampling::RasterArea faz a média exata da fonte sobre o pixel,
  em espaço premultiplicado, com cobertura de área nas bordas (DCP4,
  valor 3).
- O orçamento de trabalho conta a pegada em texels, igual no Rust e na
  pré-checagem TS.
- A área é convenção do Rust e não passa pela sonda de plataforma.
- recordCanvasReferences.mjs substitui o gravador anterior e grava as
  suítes resampling e minification no WebView2 ou no Edge headless.

Provas: referência independente em TypeScript igual byte a byte ao Rust
em 192 casos; 36 casos de regressão contra o WebView2 real na faixa
bilinear; testes Rust de média exata, cobertura de borda, quarto de
volta, recusas, tiles e custo por amostra.
```

## 2. Próximos passos, em ordem

1. **Fechar esta fatia:** a bateria da seção 1, a entrada no roadmap, o commit e
   o push.
2. **Orçamento de fontes do consumidor experimental.** O limite de 16 MiB por
   documento ainda manda fotos comuns para o legado: uma de 4000×3000 tem
   48 MiB. Hoje é o que mais limita o alcance real do Rust. Exige medir a memória
   do WASM antes de subir o limite; não subir sem medição.
3. **C4 — preview ao vivo em superfície única.** É a migração visível ao usuário
   e ainda não começou. Só vale a pena depois do passo 2, senão fica inativa na
   prática. Pontos de partida:
   - `CanvasSurface.vue` monta um `CanvasLayer` por camada, e o `pointerdown` da
     camada depende desse elemento DOM (teste de acerto).
   - As prévias de pincel, borracha, degradê e movimento de seleção ficam dentro
     do composto de cada camada.
   - O roadmap exige flag, ausência de piscada e QA manual antes de remover o
     legado.
4. **Lacunas que continuam em fallback:**
   - texto com efeitos ou em modo diferente de Normal — depende da decisão de
     produto registrada no contrato de texto (mesclar texto isolado, como o
     preview, ou por operação, como a exportação legada);
   - rotação arbitrária;
   - escala de exportação diferente de 1:1 (exportação com outro DPI);
   - miniaturas e conteúdo inteligente.
5. **Manutenção:** quando o WebView2 distribuído mudar de versão, regravar as
   fixtures com
   `npm run record:canvas-references -- --target webview2 --suite resampling`
   (e `--suite minification`) e rodar `scripts/tests/rustRasterParity.test.ts`.

## 3. Lembretes do ambiente

- Commits deste repositório não levam linha `Co-Authored-By`.
- No Windows, usar `npm.cmd` no PowerShell.
- Os arquivos usam CRLF no checkout (`autocrlf`); scripts que editam texto
  precisam preservar o final de linha.
- O Rust e o Go estão fixados (`rust-toolchain.toml` em 1.98.1, Go 1.26.5 de
  `go.mod`); o `PATH` precisa do Go para os smokes Wails.
