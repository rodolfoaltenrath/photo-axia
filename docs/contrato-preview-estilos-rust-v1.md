# Preview real de estilos Rust — integração experimental V1

## 1. Alcance da 23ª fatia

O serviço da [22ª fatia](contrato-servico-estilos-rust-v1.md) agora atende um
consumidor real: `useLayerStyleRaster` no canvas. O PNG é produzido pelos passes
Rust existentes e apresentado pelo handoff atual. **Não é ainda o compositor
único do documento.** Continuam os `<img>` por camada e a composição DOM.

A integração permanece **desligada por padrão**. Ativação explícita:

```powershell
.\axia.exe --axia-rust-styles-preview
```

No frontend de desenvolvimento, usar `?axiaRustStyles=1`. Apenas o valor `1`
ativa a opção. Não existe preferência persistida, ativação automática por
benchmark ou mudança no arquivo `.axia`. O flag da sonda ABI `axiaRustPoc`
permanece separado. O argumento Go só monta a URL inicial; Go não compõe pixels.

Um executável já existente precisa ser recompilado para incluir esta fatia.
Os executáveis dos smokes são temporários e não são instalador/portável de release.

## 2. Posse e agendamento

Por janela, somente **um consumidor `canvas:*`** pode possuir o serviço Rust.
O primeiro que solicitar estilo ocupa o slot até ficar sem raster/estilo ou
desmontar/resetar o documento. Não é necessariamente a camada selecionada.
Outros canvases, miniaturas e exportação continuam em `renderLayerStyle`.
Não há prioridade baseada em seleção, fila entre camadas ou pool global.

Novo dono aguarda término do Worker adotado pelo anterior. O serviço criado
pela factory é lazy: uma factory tardia sem dono é descartada antes de enviar
render/abrir Worker. Falta uma política compartilhada entre janelas nativas.
Não criar um serviço por camada para ampliar esta experiência.

O serviço Rust continua com um ativo + um pendente. Antes dele há preparação
browser de Blob/assets com `AbortSignal`, revisão por token e deadline de 30 s.
Invalidate aborta a preparação e cancela render visual, sem cancelar staging.
Texto/estilos/luz são capturados; carregamento/resultado atrasado não publica.
Módulos experimentais são importados somente no caminho opt-in; HTML padrão
não carrega/precarrega Worker/WASM/runtime experimental.

Para imagens, o adaptador usa a URL capturada pelo hook e fetch abortável, não
executa loaders editoriais arbitrários no Rust. Texto usa a descrição existente,
sem troca de shaping, fonte, métricas ou desenho browser. Assets ativos são
deduplicados e carregados em sequência; textura de bisel desabilitada não é
carregada. Resposta HTTP, tamanho declarado e Blob pronto são verificados;
cada Blob e a soma de assets têm limite de 64 MiB.

Metadados/efeitos/insets/geometria/PNG e limites de buffers seguem os contratos
do serviço/Worker. A checagem do Blob pronto ocorre após ler a resposta; não
promete impedir todas as alocações do fetch. Limites intrínsecos de imagens e
orçamento compartilhado entre preparação, caches, Workers e janelas continuam
pendentes. Não é teto de RSS.

## 3. Identidade, cache e paridade

A identidade editorial original pode conter uma data URL grande. O adaptador
compara **a string exata**, mantém somente a identidade corrente do dono e
atribui uma versão curta monotônica para a fonte Rust. Não usa truncamento ou
hash com colisões. Mudança só de efeito conserva a versão; mudança de conteúdo
altera a versão. Dimensões, escala, insets e qualidade continuam na chave da
sessão. O chamador precisa atualizar a identidade/editToken ao mudar conteúdo.

Chaves dos resultados Rust têm namespace, época do dono e ID do pedido. PNGs
Rust não entram no cache compartilhado legado ou no cache de decoded de
exportação. Não há cache adicional de PNG/padrão no adaptador, nem resultado
Rust disfarçado de hit legado. Renderização integral de uma camada usa a mesma
sessão regional já testada; tiles do viewport são um passo posterior.

Texto com traçado nativo continua no caminho vetorial existente e pode nem
solicitar raster. Exportação, amostragem, miniatura, mesclagem e rasterização
continuam no compositor anterior; esta fatia não comprova paridade completa
entre todos esses consumidores.

## 4. PNG, URL e handoff

O resultado tem `release()` obrigatório. O hook:

1. Libera imediatamente o resultado que perdeu a geração antes da publicação.
2. Cria URL; falha na criação também libera a lease.
3. Guarda URL, geometria e callback de liberação juntos.
4. Mantém o PNG enquanto algum buffer do handoff ainda usa a URL.
5. Revoga URL e libera PNG quando o handoff retira a fonte, ou no unmount.

Não revogar o raster ativo ao pedir a próxima versão. O handoff continua com
decode/dois frames antes da troca e liberação posterior do buffer antigo.
Dispose do Worker não revoga PNG já entregue; o callback continua válido.
Release é idempotente. O contador `resultLeases` do adaptador cobre resultados
entregues ainda em uso, inclusive de um serviço retirado; não mede memória real
nem impõe orçamento global entre serviços antigos/novos.

## 5. Fallback e circuito

Falha de preflight, preparação, init, plataforma, Worker, encode ou orçamento
não elimina silenciosamente o estilo: o adaptador fecha o serviço Rust adotado
e pede o mesmo estilo ao compositor atual. Se esse caminho também falhar, o
hook mantém seu tratamento anterior de erro. Cancelamento/obsolescência nunca
inicia fallback nem publica resultado antigo.

A primeira falha abre um circuito para a vida desse dono: pedidos seguintes
usam legado, evitando tentar WASM/OOM/timeout repetidamente durante edição.
Retirar o dono/resetar documento permite uma nova tentativa. Não há retries
automáticos, troca permanente de preferências ou toast de falha do experimento.
O motivo está no diagnóstico; não colocar texto, URL ou conteúdo do documento ali.

## 6. Instrumentação e validação

Somente com o caminho opt-in carregado, `data-axia-rust-style-preview` no elemento
raiz guarda um snapshot limitado: tentativas/renders/fallbacks/cancelamentos,
slot ocupado, circuito, leases, contas do serviço e último backend/motivo.
Timings agrupam preparação de Blob/assets, render do serviço (inclui abertura,
fila, staging/decode e encode), total do adaptador, kernel e encode PNG.
Não apresentam decode/fetch/IPC como fases isoladas que ainda não são medidas.

O smoke do canvas mede publicação → load → ativação do buffer, verifica pixels
do screenshot e ausência de perda do buffer ativo. Assim o caminho real tem
observações de adaptador + handoff, mas os tempos têm inícios diferentes: não
somar indiscriminadamente e não tratá-los como benchmark de FPS/ganho percentual.

```powershell
# Após build; em Windows/WebView2.
npm run smoke:preview-wails --ignore-scripts -- --rust-styles
npm run smoke:preview-wails --ignore-scripts -- --rust-styles-fallback
```

O primeiro exige backend Rust e PNG real visível; o segundo bloqueia apenas o
fetch do WASM no perfil temporário e exige fallback legado. Ambos removem a
camada pela UI e verificam slot retirado e zero leases publicadas pendentes.
O smoke sem argumentos continua verificando o caminho normal. Capturas e
contagens não substituem QA de fontes, cores, DPR, camadas grandes ou desempenho.

## 7. QA manual e próxima fatia

Com flag desligada, conferir estilos/miniaturas/exportação como antes. Com flag
ligada, começar com um documento de uma camada para garantir que o slot a atende:

- Imagem raster e texto editável com sombra, brilho, bisel, traçado, Fill,
  padrões/texturas e combinações; comparar com execução sem flag/exportação.
- Digitar/editar parâmetros rapidamente, zoom/pan/Ctrl+T, undo/redo e remover
  camada durante processamento. Nenhum PNG antigo/flash/erro indevido.
- Desligar estilo, trocar documento, fechar/reabrir e editar outra camada;
  Worker não se multiplica e as URLs/leases antigas são retiradas.
- Documentos acima dos limites experimentais devem continuar pelo compositor
  anterior; registrar motivo/backend e gargalos, não concluir que o limite foi
  aumentado ou o processamento inteiro ficou em Rust.

Próximos passos: pool/prioridades e orçamento global, política de cache e assets,
limites intrínsecos, medições repetidas isoladas e matriz visual de tolerâncias,
antes de aumentar cobertura/ativar por padrão. C0/C1/C2 continuam abertos. C3 é a
pilha documental/backdrop/transforms; C4 é a superfície única. O idioma e o modelo
editorial permanecem separados desta integração.
