# Continuação da migração Rust — estado em 2026-10-27

Anotação para retomar o trabalho em outra máquina. Detalhes técnicos de cada
decisão ficam nos contratos em `docs/`, principalmente
`contrato-reamostragem-raster-rust-v1.md` (seções 5.2 e 6.1),
`contrato-texto-documental-rust-v1.md` e `contrato-consumidor-documental-rust-v1.md`
(seção 4, limites).

## 1. Situação

- Redução de imagem (fatia 13): concluída no commit `bf86d37`.
- Orçamento de fontes e compositor mais rápido (fatia 14): concluída em
  2026-10-27. Fotos de 12 MP entram no Rust; números e decisões no roadmap.
  Bateria: frontend 622/622, WASM 453/453, cargo 150/150, clippy, fmt, go test,
  oráculos de documento e de reamostragem no Edge headless, smoke Wails 2/2 e
  `benchmark:rust-media-wails` com a foto de 12 MP igual byte a byte à fonte.

## 2. Decisão de 2026-10-27: substituir, não conviver

Com os dois caminhos vivos não dá para saber se algo funciona por causa do Rust ou
do legado. A ordem combinada:

1. **Bloco 1 — fechar todas as lacunas que hoje caem no legado** (sem legado não
   haverá fallback). Feito: texto em modos de mesclagem (semântica do preview,
   `19311e9`), texto com efeitos (`135f654`), forma e fundo com efeitos
   (`0d54ef4`), rotação arbitrária com escalas ≥ 0,5 (modo de cobertura). Faltam,
   nesta ordem: rotação com redução abaixo de 0,5 (pré-filtro de área), saída em escala diferente de 1:1 e origem
   fracionária (`output-scale-or-size`, `output-grid-quality`), reamostragem com
   `Mesclar se` de baixo (`source-transform-blend-if`), objetos inteligentes/PDF
   e miniaturas (`non-image-layer`, propósitos `smart`/`thumbnail`), fotos de
   24 MP e camadas grandes com efeitos.
2. **Bloco 2 — C4**, preview ao vivo em superfície única (detalhes abaixo).
3. **Bloco 3 — Rust como padrão.**
4. **Teste de fogo do usuário**, depois **remoção do legado**; bugs são corrigidos
   conforme relatados, sem período longo de convivência.

## 3. Próximos passos — detalhes

1. **C4 — preview ao vivo em superfície única.** É a migração visível ao usuário
   e ainda não começou. Agora que fotos comuns cabem no consumidor, deixou de
   ser inativa na prática. Pontos de partida:
   - `CanvasSurface.vue` monta um `CanvasLayer` por camada, e o `pointerdown` da
     camada depende desse elemento DOM (teste de acerto).
   - As prévias de pincel, borracha, degradê e movimento de seleção ficam dentro
     do composto de cada camada.
   - O roadmap exige flag, ausência de piscada e QA manual antes de remover o
     legado.
   - O consumidor compõe tiles de 256×256 da saída inteira a cada render; para o
     preview, só os tiles visíveis e sujos devem ser recompostos.
2. **Lacunas que continuam em fallback:**
   - texto com efeitos ou em modo diferente de Normal — depende da decisão de
     produto registrada no contrato de texto (mesclar texto isolado, como o
     preview, ou por operação, como a exportação legada);
   - camada raster **com** efeitos acima de ~19 MiB (o STG1 materializa uma cópia
     estilizada e um pico 2×);
   - fotos de 24 MP ou mais (exigem subir as quotas de 64/96 MiB do núcleo, com
     nova medição);
   - rotação arbitrária;
   - escala de exportação diferente de 1:1 (exportação com outro DPI);
   - miniaturas e conteúdo inteligente.
3. **Manutenção:** quando o WebView2 distribuído mudar de versão, regravar as
   fixtures com
   `npm run record:canvas-references -- --target webview2 --suite resampling`
   (e `--suite minification`) e rodar `scripts/tests/rustRasterParity.test.ts`.

## 4. Lembretes do ambiente

- Commits deste repositório não levam linha `Co-Authored-By`.
- No Windows, usar `npm.cmd` no PowerShell.
- Os arquivos usam CRLF no checkout (`autocrlf`); scripts que editam texto
  precisam preservar o final de linha.
- O Rust e o Go estão fixados (`rust-toolchain.toml` em 1.98.1, Go 1.26.5 de
  `go.mod`); o `PATH` precisa do Go para os smokes Wails.
- Smokes Wails e testes com Worker falham por tempo quando a máquina está
  carregada (navegador, outro `cargo build`); o HEAD falha igual nessas
  condições. Repetir com a máquina ociosa antes de suspeitar do código.
- `npm run benchmark:rust-document-budget` mede memória WASM e tempo de uma foto
  grande; `npm run benchmark:rust-media-wails` mede a mesma foto no WebView2 real.
