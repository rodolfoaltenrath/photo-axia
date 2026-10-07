# Preparação de pilha estilizada Rust — C3, fatia 4

Estado: integração **nativa segura**, sem novo export WASM, protocolo Worker,
consumidor editorial ou rollout. Liga o executor STG1 ao compositor documental
existente, separando preparação e render regional. A ABI DCP1/DCP2 permanece
inalterada; o Worker documental continua compondo os rasters recebidos, sem
pacotes de estilos por camada documental.

Relacionado à [pilha](contrato-pilha-documental-rust-v1.md),
[transformações DCP2](contrato-transformacoes-documentais-rust-v1.md),
[estágios STG1](contrato-estagios-v1.md) e
[roadmap](roadmap-compositor-rust-internacionalizacao.md).

## 1. Interface e ciclo de vida

`rust/axia-pixel-core/src/document_styles.rs` expõe:

```text
prepare_styled_document(job: DocumentCompositeJob, style_packets: &[Option<&[u8]>])
  -> Result<PreparedStyledDocument, StyledDocumentError>

prepared.compose_region(region, output: &mut [u8]) -> Result
prepared.resident_bytes() -> usize
```

Uma entrada de `style_packets` por camada, na mesma ordem inferior → superior.
`None` usa a fonte sem estilo; `Some` exige STG1 válido, mesmo sem efeitos.
Não inferir Fill pelo alfa do raster nem aceitar silenciosamente lista de
tamanho diferente. `resolution_scale` e `output_grid` mantêm o contrato DCP2.

A preparação valida a geometria documental, todas as fontes, os pacotes e o
orçamento agregado. Só depois gera uma fonte estilizada para cada camada visível
com opacidade positiva. O objeto resultante possui esses buffers; as fontes e
os descritores originais são emprestados de um snapshot imutável do chamador.
O borrow Rust impede que esse snapshot seja alterado enquanto houver uso.

Os pacotes STG1 não permanecem emprestados após o retorno. Os planos e buffers
temporários dos filtros são liberados. Compor outros tiles não executa estilos
ou Fill novamente, nem copia o raster estilizado: monta descritores temporários
e chama o mesmo `compose_document_region`. Região de resposta continua global.
Drop libera as fontes estilizadas; não há cache global, IDs, revisões de modelo,
handles WASM ou ownership de documento/histórico nesta interface.

Camada oculta ou com opacidade zero não aloca raster estilizado, mas seu pacote
é validado, inclusive os limites conservadores do executor STG1. Camada visível
fora da região inicial **é preparada**: outro tile pode precisar dela. Uma nova
aparência exige nova preparação; não alterar visibilidade/matriz/estilo dentro
do objeto nem publicar um resultado de revisão antiga.

## 2. Ordem visual e grade preparada

```text
fonte com padding/insets já preparados
  → externos → conteúdo/Fill → internos → overlays → superiores → Esta camada
  → amostragem afim/grade global → opacidade da camada → blend sobre a pilha
```

Reutiliza STG1 e seus dez tipos de efeito, sem novo despacho ou aritmética.
Fill mantém `round(originalAlpha * fill/100)` no conteúdo. Todos os efeitos
continuam usando a máscara original; Fill zero não apaga sombra/overlay/traçado.
Opacidade da camada é aplicada depois de estilizar/transformar, uma única vez.
`Esta camada` lê o raster estilizado antes da transformação documental.

Esta interface **não** calcula padding, modifica tamanho de fonte, resolve
assets, desenha texto ou converte unidades de efeitos. O chamador entrega a
grade original com insets transparentes suficientes e os parâmetros dos efeitos
já resolvidos nessa grade. Kernels usam halo/contexto nessa fonte completa;
não recortar a fonte por bounds do tile documental antes de filtrar.

Se `M` mapeia a fonte sem padding para o documento e o padding adiciona
`left/top`, a matriz da fonte preparada deve ser `M × translate(-left, -top)`.
Para `[a,b,c,d,tx,ty]`, a translação preparada é:

```text
txPrepared = tx - a * left - c * top
tyPrepared = ty - b * left - d * top
```

Não recentrar pelo tamanho expandido. A prova nativa cobre sombra, Fill,
opacidade e padding com rotação de 90°. Adapter editorial para essa matriz,
qualidade/resolução de texto e unidades documentais dos estilos ainda faltam;
não tratar esses testes como autorização para ampliar traçado junto do texto.

`Blend If` subjacente **não** foi integrado. Precisa de backdrop já composto,
ordem de quantização e comparação com o caminho Canvas antes de entrar aqui.
Também permanecem abertos os gates de minificação e paridade tolerante Canvas.

## 3. Memória, trabalho e atomicidade

Limite agregado de preparação: **96 MiB**, incluindo:

```text
fontes originais (cada referência)
  + todas as fontes estilizadas a reter
  + pacotes STG1 (cada referência)
  + metadata dos efeitos (2048 bytes por efeito)
  + workspace por camada (512 bytes)
  + saída da região inicial
  + max(2*rasterEstilizado + filtrosDoPasseNoPico + 2048)
```

Não cobrar apenas o orçamento isolado de cada efeito/camada. As fontes de
camadas anteriores ficam vivas enquanto a próxima é preparada. Cobrar o pico
dos filtros sequenciais, não somá-los, mas somar todas as fontes a reter.
A reserva de workspace cobre descritores originais/temporários, listas de
buffers, opções de planos e referências; teste verifica os tamanhos nativos.
Metadata é contabilizada antes de materializar planos; raster só após preflight
de todos os pacotes. As reservas de `Vec` usam `try_reserve_exact`.

Depois da preparação, `resident_bytes()` inclui fontes originais, fontes
estilizadas e workspace. `compose_region` soma a saída pedida ao budget; pacotes
e planos liberados já não entram. Continua a validação independente do núcleo
documental, incluindo sua quota de amostras transformadas por região.

Quota adicional de preparação: até **16 * 1024 * 1024 pass-pixels**, somando
`sourceWidth * sourceHeight * (efeitos + conteúdo + filtro Esta camada)` das
camadas executadas. Não depende do tamanho do tile inicial: um tile pequeno não
autoriza preparar centenas de passes em fontes enormes. É um limite conservador
de passes completos, não contagem de operações internas dos filtros, prazo,
RSS, FPS ou orçamento entre Workers/janelas.

Erros tipados: `Composite(...)`, `Style(status)`, `MemoryBudget`, `WorkBudget`.
Status de memória `6` do executor STG1 é convertido para `MemoryBudget`.
Preparação não modifica fontes/saídas e só retorna o objeto completo após todos
os estilos terminarem. Uma preparação nova falhando não invalida um objeto
anterior. Falha de composição preserva a saída e permite reutilizar o preparado.
Ainda não há promessa de recuperação de OOM do SO nem prova de fault injection
do allocator nativo; esses casos exigem validação específica da futura ABI.

## 4. Provas e próximos gates

Dezoito casos nativos novos cobrem passthrough nos seis modos, Fill e opacidade
fracionários, alfa/RGB oculto, Fill zero com efeitos, traçado circular,
`Esta camada` depois do overlay, padding rotacionado, empty stack, preparação
de fontes offscreen, descarte de buffers ocultos, rejeição tardia, orçamento
agregado e quota de trabalho. Tiles 1/2/3/7 com rotação e escala fracionária
concordam byte a byte com a composição inteira e com os kernels anteriores
executados separadamente. Repetição não reaplica Fill nem troca o buffer.

O refactor interno de STG1 separa preflight/execução para compartilhar o plano;
seu export de 12 argumentos, layout, ordem, budgets e pixels continuam iguais.
A matriz WASM/Worker existente continua sendo o oráculo dessa preservação,
incluindo os dez efeitos, padrões/texturas e os goldens sem regravação.

Próximos passos: expor esta integração numa ABI versionada com ciclo de vida e
orçamento explícitos; ligar ao runtime/Worker sem recalcular efeitos por tile;
integrar `Blend If` subjacente; implementar preparação editorial, scheduler,
revisões/admission e consumidor offscreen atrás de flag. Não conectar diretamente
esta preparação integral ao evento de zoom/pan. Granularidade por camada/dirty
regions e pressão de memória ainda precisam de desenho/medição.

Nenhuma alteração de preview/default/exportação, texto, idiomas, versões,
instalador ou remoção de legado nesta entrega. C3/C4 continuam abertos.

## 5. Validação local — 2026-10-07

- Rust **116/116** testes; os **18** casos novos de pilha estilizada também
  passaram em release. `cargo fmt --check` e `git diff --check` passaram.
- Frontend **587/587** e typecheck das suítes passaram.
- WASM/Worker **384/384**: cinco casos standalone WASM, um standalone Worker
  e **378** scripts. Os goldens e a matriz STG1 validam o refactor do executor;
  **não** exercitam a nova pilha estilizada no WASM, pois ela não tem export.
- Build Vue/TypeScript/Vite e bundle Rust passaram: WASM
  `axia_pixel_core-0zBJ_btV.wasm`, **115053 bytes**, íntegro contra o Cargo;
  Worker `rustPixelPoc.worker-Pt-X7A0g.js`. Aviso pré-existente de chunk grande
  permanece sem falha de build.
- `go test ./...` passou. Diagnóstico Wails/WebView2 incorporado, preview normal,
  estilos Rust opt-in e fallback forçado passaram, sem perda do estado ativo.
  São regressões dos caminhos atuais, não uma nova integração editorial.
- Ambiente: Node **24.14.1**, Rust **1.98.1**, Go **1.26.5**, Windows
  **10.0.26200**, WebView2/Edge **154.0.4258.62**.

Não foi medido ganho de FPS desta interface nem feita validação manual do usuário.
Os smokes removeram seus executáveis temporários; nenhuma distribuição foi gerada.
