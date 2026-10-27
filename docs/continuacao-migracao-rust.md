# Continuação da migração Rust — estado em 2026-10-27

Anotação para retomar o trabalho em outra máquina. Detalhes técnicos de cada
decisão ficam nos contratos em `docs/`, principalmente
`contrato-reamostragem-raster-rust-v1.md` (seções 5.2 e 6.1) e
`contrato-texto-documental-rust-v1.md`.

## 1. Situação da fatia de redução de imagem

Concluída: commit `bf86d37`, validada em 2026-10-27 com a bateria completa
(frontend 622/622, WASM 450/450, build, bundle, oráculos de documento e de
reamostragem no Edge headless, smoke Wails 2/2 com a reamostragem ativa, cargo
146/146, clippy, go test) e registrada no roadmap como décima terceira fatia de C3.

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
