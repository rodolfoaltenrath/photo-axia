# Preview real de estilos Rust — integração experimental V1

## 1. Alcance — atualização da 29ª fatia

O serviço da [22ª fatia](contrato-servico-estilos-rust-v1.md) agora atende um
consumidor real: `useLayerStyleRaster` no canvas. O PNG é produzido pelos passes
Rust existentes e apresentado pelo handoff atual. **Não é ainda o compositor
único do documento.** Continuam os `<img>` por camada e a composição DOM.

A 23ª fatia atendia um dono por janela. A 24ª criou o
[agendador compartilhado](contrato-agendador-estilos-rust-v1.md); a 25ª liga
várias camadas reais à mesma instância, incluindo preparação serializada antes
do fetch e smoke multicamadas Wails. A composição final ainda é DOM, não Rust.
Na 26ª, a fila recebe prioridades do canvas, atualizadas sem reiniciar render.
A 27ª acrescenta [cache LRU de mídia codificada](contrato-cache-midia-preview-rust-v1.md),
reservado dentro do orçamento anterior, sem cache de RGBA ou de resultado final.
A 28ª acrescenta [limites intrínsecos antes do decode](contrato-limites-decode-preview-rust-v1.md)
para fontes/padrões PNG/JPEG/GIF. Dimensões indeterminadas ou acima do orçamento
usam fallback local sem invocar o decoder Rust; isso não limita o RSS do legado.
A 29ª separa [medidas de mídia](contrato-medicao-midia-rust-v1.md) no Worker,
com reuso explícito da fonte e benchmark opt-in no WebView2 real. Não cria cache
decodificado nem altera a composição.

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

Por janela, consumidores `canvas:*` compartilham **um agendador/Worker**,
sem serviço exclusivo por camada. Até 64 consumidores podem manter estado
experimental; excedentes usam legado. A fila tem um ativo e até 16 pendentes,
com somente o último pedido de cada consumidor. A ordem preferencial é camada
ativa → camada no viewport → camada fora do viewport; FIFO desempata. Substituir
pendente preserva posição e envelhecimento. Após três ultrapassagens, o pedido
mais antigo ganha um despacho, mesmo com rajadas de prioridade maior. É limite
de ultrapassagens, não garantia de latência em milissegundos. Atualizar o ativo
coloca sua próxima versão na fila; prioridade não interrompe trabalho em curso.
Miniaturas/exportação continuam no legado. Não há pool entre janelas nativas.
Prioridades só ordenam a fila Rust; o fallback conserva o agendamento legado.

O canvas usa transform desejado, offset/zoom e tamanho já existentes do viewport;
não lê layout DOM a cada pan nem cria IntersectionObservers por camada. O halo
é calculado na escala do raster e convertido ao documento, incluindo alongamento
não uniforme e limite de densidade do texto. Bounds rotacionados e margem externa
conservadora evitam rebaixar efeitos próximos da borda; geometria indefinida fica
no nível visível. Trata-se de prioridade, **não culling**: conteúdo fora da tela
continua elegível. Tiles/suspensão regional pertencem a C4. Camadas ocultas já não
eram montadas pelo canvas; seu unmount continua cancelando/liberando o consumidor.
Ao mostrar, a montagem solicita a versão atual, sem conservar a fonte do dono oculto.

Seleção/pan só atualizam prioridade; não entram no watcher de pixels/estilos,
não alteram identidade, reserva, URL ou lease, nem buscam mídia novamente.
Atualização durante import/factory lazy é preservada para o primeiro enfileiramento.
Repriorizar um consumidor inexistente não cria registros persistentes. O caminho
sem flag não calcula essas prioridades de viewport nem abre runtime experimental.

Remover uma camada não encerra o Worker usado pelas demais. Ao retirar o último
consumidor ou resetar documento, fecha-se a instância compartilhada. Novo
contexto espera o término anterior; factory tardia de contexto retirado é
descartada antes de enviar trabalho/abrir Worker. A factory permanece lazy.

A fila recebe preparação deferida: preflight de geometria/PNG/assets/metadados
acontece antes da factory e do fetch; o loader só inicia após admissão e despacho.
Metadados estimados são limitados a 4 MiB por pedido. Durante fetch, reserva-se
128 MiB para mídia codificada (64 MiB de origem + 64 MiB de padrões), além
da fonte staged existente, metadados, fila e PNGs com lease. Ao concluir, troca-se
a reserva pelos tamanhos reais e confere-se novamente o orçamento antes do Worker.
Não significa reservar fisicamente um buffer de 128 MiB.

Invalidate aborta apenas a preparação/render daquele consumidor. Promises visuais
podem rejeitar antes de decode/encode drenar: a fila espera essa drenagem antes
do próximo consumidor. Texto/estilos/luz são capturados; resultado atrasado não
publica. Deadline visual de 30 s inclui fila/preparação/render. Preparação tem
watchdog próprio: se não drenar no prazo, a instância torna-se terminal para
não sobrepor um loader tardio a novas preparações. Dispose não espera loader
que ignore abort; sua resposta tardia nunca abre Worker/publica.
Módulos experimentais são importados somente no caminho opt-in; HTML padrão
não carrega/precarrega Worker/WASM/runtime experimental.

Para imagens, o adaptador usa a URL capturada pelo hook e fetch abortável, não
executa loaders editoriais arbitrários no Rust. Texto usa a descrição existente,
sem troca de shaping, fonte, métricas ou desenho browser. Assets ativos são
deduplicados e carregados em sequência; textura de bisel desabilitada não é
carregada. Resposta HTTP e tamanho declarado são verificados; leitura em stream
interrompe/cancela o corpo assim que ultrapassa o limite, inclusive com header
ausente/incorreto. Cada Blob e a soma dos assets têm limite de 64 MiB.

Metadados/efeitos/insets/geometria/PNG e limites de buffers seguem os contratos
do serviço/Worker. A reserva agregada padrão continua em 256 MiB: capacidade de
32 MiB do cache é descontada do serviço (224 MiB, menos PNGs de contextos antigos).
Blobs emprestados à entrada também são cobrados pelo serviço, conservadoramente.
Não cobre cópias internas
de rede/stream/Blob/Canvas, heap real, URLs editoriais já existentes, memória WASM
já crescida ou imagem intrínseca antes de resize. Limites intrínsecos, caches decodificados,
processamento legado e orçamento entre janelas continuam pendentes. Não é RSS.

## 3. Identidade, cache e paridade

A identidade editorial original pode conter uma data URL grande. O adaptador
compara **a string exata**, mantém somente a identidade corrente do dono e
atribui uma versão curta monotônica para a fonte Rust. Não usa truncamento ou
hash com colisões. Mudança só de efeito conserva a versão; mudança de conteúdo
altera a versão. Dimensões, escala, insets e qualidade continuam na chave da
sessão. O chamador precisa atualizar a identidade/editToken ao mudar conteúdo.

Chaves dos resultados Rust têm namespace, épocas de contexto/consumidor e ID
do pedido. Remontar uma camada com o mesmo ID não reutiliza versão antiga.
O agendador também separa identidades por consumidor; só existe um slot staged,
portanto alternar camadas exige staging, não cache de fontes por camada. PNGs
Rust não entram no cache compartilhado legado ou no cache de decoded de
exportação. O cache de mídia guarda fonte por consumidor/versão compacta/URL e
padrões por assetId/URL/dimensões; até 64 entradas e 32 MiB incluindo metadados.
Só blob/data são retidos; fonte direta/texto não entram. Edição de conteúdo
invalida fonte mesmo com URL igual. Clear/release/abort impedem fills tardios.
Não há cache adicional de PNG/RGBA no adaptador, nem resultado
Rust disfarçado de hit legado; fromCache continua false. Renderização integral de uma camada usa a mesma
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
entregues ainda em uso, inclusive de um serviço retirado; não mede memória real.
O adaptador também impõe 64 MiB/64 leases de resultados publicados,
incluindo contextos retirados. Ao abrir nova instância, desconta resultados
antigos de seus limites de memória/PNG/leases. Esses limites são conservadores
e não crescem automaticamente ao liberar uma lease antiga; não cobrem legado/RSS.

## 5. Fallback e circuito

Falha de preflight, preparação, init, plataforma, Worker, encode ou orçamento
não elimina silenciosamente o estilo: o adaptador pede o mesmo estilo ao
compositor atual. Falhas locais de input/orçamento abrem circuito só da camada,
sem terminar o serviço usado pelas outras. `wasm-unavailable`/deadline abrem
circuito comum e encerram o agendador antes do fallback; pedidos válidos que
foram cancelados por esse fechamento também seguem pelo legado. Se o legado falhar, o
hook mantém seu tratamento anterior de erro. Cancelamento/obsolescência nunca
inicia fallback nem publica resultado antigo.

Circuito local dura até retirar o consumidor; circuito comum dura até retirar
todos os consumidores/resetar documento. Isso evita repetir fetch/init WASM por
camada a cada edição após uma falha. Não há retries
automáticos, troca permanente de preferências ou toast de falha do experimento.
O motivo está no diagnóstico; não colocar texto, URL ou conteúdo do documento ali.

## 6. Instrumentação e validação

Somente com o caminho opt-in carregado, `data-axia-rust-style-preview` no elemento
raiz guarda um snapshot limitado: tentativas/renders/fallbacks/cancelamentos,
consumidores e contagem por prioridade, circuito local/comum, leases/bytes publicados (inclusive antigos),
contas do agendador, preparação/fila ativa, cache codificado e último backend/motivo.
Timings agrupam espera de instância/fila + preparação de Blob/assets, render
do serviço (abertura do Worker, staging/decode, efeitos e encode), total do
adaptador, kernel e encode PNG. Não são tempos exclusivos de CPU de cada fase.
`last.media` agora separa cabeçalho, createImageBitmap/decode/resize, desenho,
readback, padding e staging da fonte, com padrões acumulados à parte. Fonte
reusada não repete tempos históricos; fallback fica sem métricas de mídia.
São tempos decorridos, não CPU exclusiva. Fetch/IPC continuam sem medidas
isoladas; os agregados incluem espera e não são a soma dessas parcelas.

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
fetch do WASM no perfil temporário e exige fallback legado. Ambos duplicam a
camada duas vezes, verificam três rasters prontos, removem um consumidor sem
prejudicar os demais e editam um estilo sem mudar o buffer da camada intocada.
O modo Rust exige uma única criação de Worker (pico de um); o modo fallback
exige zero. Ao final, removem as camadas estilizadas e exigem zero consumidores,
leases/bytes e Workers de posse do experimento. A contagem observa chamadas da
API Worker; não mede processos físicos/GC nem pool global do aplicativo.
O smoke sem argumentos continua verificando o caminho normal. Capturas e
contagens não substituem QA de fontes, cores, DPR, camadas grandes ou desempenho.
Os smokes opt-in também selecionam outra camada e fazem pan sem novos renders
ou troca dos buffers prontos. Ocultar uma camada reduz consumidores/leases sem
terminar o Worker restante; mostrar recompõe mantendo uma única criação de Worker.
Editar estilo deve aumentar hits do cache codificado sem nova leitura da fonte.
Ao retirar o último consumidor, entradas/bytes do cache também precisam zerar.

## 7. QA manual e próxima fatia

Com flag desligada, conferir estilos/miniaturas/exportação como antes. Com flag
ligada, começar com poucas camadas estilizadas e expandir gradualmente:

- Imagem raster e texto editável com sombra, brilho, bisel, traçado, Fill,
  padrões/texturas e combinações; comparar com execução sem flag/exportação.
- Digitar/editar parâmetros rapidamente, zoom/pan/Ctrl+T, undo/redo e remover
  camada durante processamento. Nenhum PNG antigo/flash/erro indevido.
- Desligar estilo, trocar documento, fechar/reabrir e editar outra camada;
  Worker não se multiplica e as URLs/leases antigas são retiradas.
- Editar/remover A enquanto B/C aguardam; mudanças não cancelam os demais.
  Testar rajadas, muitas camadas, pressão de orçamento e fallback por camada.
- Alternar camada ativa e pan com renders pendentes; fila acompanha relevância,
  sem reiniciar pixels ou impedir definitivamente os pedidos antigos. Conferir
  efeitos externos próximos da borda, rotação e resize não uniforme. Ocultar/
  mostrar durante preparação deve cancelar só o consumidor retirado.
- Documentos acima dos limites experimentais devem continuar pelo compositor
  anterior; registrar motivo/backend e gargalos, não concluir que o limite foi
  aumentado ou o processamento inteiro ficou em Rust.

Próximos passos: ampliar cobertura/QA dos limites intrínsecos e orçamento entre janelas,
validar medições de decode em documentos reais antes de decidir cache decodificado,
medições repetidas isoladas e matriz visual de tolerâncias,
antes de aumentar cobertura/ativar por padrão. C0/C1/C2 continuam abertos. C3 é a
pilha documental/backdrop/transforms; C4 é a superfície única. O idioma e o modelo
editorial permanecem separados desta integração.

Auditoria da primeira fatia C3 confirmou que a janela nativa atual de estilos
só envia parâmetros ao editor, sem Worker Rust próprio. Coordenação agregada
é gate para futuras instâncias concorrentes, não orçamento distribuído já
implementado. O [núcleo inicial da pilha](contrato-pilha-documental-rust-v1.md)
está testado em Rust nativo e pela ABI DCP1/WASM/Worker de diagnóstico. A
[fatia DCP2](contrato-transformacoes-documentais-rust-v1.md) acrescenta afins e
grade global, mas nenhuma dessas chamadas documentais é usada por este preview.
