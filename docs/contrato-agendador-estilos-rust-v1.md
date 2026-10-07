# Agendador compartilhado de estilos Rust — V1

## 1. Escopo da 24ª fatia

`frontend/src/editor/rustPixelPocStyleScheduler.ts` permite que consumidores
distintos usem **um serviço compartilhado**, com um Worker adotado por vez e
um slot de fonte. É a base isolada para ampliar o preview experimental, não
essa ampliação já ativada. A factory browser e o preview da 23ª fatia continuam
com um dono por janela. Não houve mudança no compositor documental, texto,
exportação, histórico, `.axia`, idioma, ABI, algoritmos Rust ou versões da stack.

Na entrega original da 24ª fatia, o agendador recebia somente mídia pronta.
A 25ª acrescenta preparação deferida e integra a factory/preview browser;
a 26ª acrescenta prioridades com envelhecimento. Ver seções 8/9 e o
[contrato atual do preview](contrato-preview-estilos-rust-v1.md).
Os testes passam
pelo Worker TS e WASM reais; decoder, Canvas e encoder são doubles explícitos.
O smoke Wails desta entrega verifica que o consumidor atual permanece íntegro,
não representa um teste multicamadas do novo agendador no browser.

## 2. API e responsabilidades

```ts
const scheduler = new RustPixelPocStyleScheduler(connect, limits)
const lease = await scheduler.render(consumerId, {
  sourceIdentity, sourceWidth, sourceHeight, styles, globalLight,
  source: { type: 'raster', blob }, // ou texto editorial
  patterns, region, resolutionScale, quality,
})
scheduler.cancel(consumerId)
lease.release() // Apenas quando o resultado deixar de ser usado.
await scheduler.dispose()
```

`connect(signal)` tem o mesmo contrato do serviço: abre/inicializa uma conexão
sob demanda, atende abort e limpa os próprios recursos se falhar. A instância
do serviço é privada ao agendador: chamá-la diretamente destruiria a garantia
de serialização. Importar/construir o agendador não abre Worker nem carrega WASM.

`consumerId` é uma chave estável, não vazia, de até 512 caracteres. Não registra
camadas permanentemente: só os trabalhos atuais/pendentes guardam suas chaves.
O chamador trata `RustPixelPocStyleCancelledError` como obsolescência, sem toast,
fallback antigo ou rejeição sem handler. Falha de orçamento usa `memory-limit`;
entrada inválida usa `invalid-input`; instância encerrada usa `wasm-unavailable`.
O agendador não escolhe fallback nem abre circuito visual por consumidor.

## 3. FIFO, substituição e drenagem

- Existe um trabalho ativo e, por padrão, até 16 consumidores pendentes,
  cada um com **somente seu último pedido**. A capacidade é configurável de
  1 a 64 consumidores pendentes, além do ativo.
- Um pedido de B nunca cancela o ativo de A. Substituir B pendente conserva
  sua posição na fila; não move B continuamente para o fim.
- Atualizar A ativo torna o pedido anterior de A obsoleto e coloca o novo A
  atrás dos consumidores que já esperavam. Rajadas de uma camada não passam
  continuamente à frente das demais.
- Novo pedido inválido da mesma camada também torna o antigo obsoleto, mas
  não cancela outras camadas. Fila cheia rejeita apenas o novo consumidor.
- Cancelar consumidor desconhecido não afeta ninguém. Cancelar B pendente
  retira sua entrada e libera a reserva correspondente.

O serviço existente rejeita cancelamento visual antes do término de
decode/encode. Seu novo `whenIdle()` espera drenagem do trabalho e das
barreiras de término físico. O agendador só despacha outro consumidor depois
dessa espera, mesmo se a Promise anterior já rejeitou. Não usa timeout como
prova de que os recursos foram liberados.

O watchdog de 30 s do serviço cobre o trabalho **após despacho**, não todo
o tempo na fila. Com fila cheia, a espera total pode ser maior. Integração
futura deve cancelar consumidores obsoletos/ocultos e definir prioridades e
deadline da experiência visual; FIFO é a política básica desta fatia.

## 4. Identidade e snapshots

O preflight/snapshot do serviço foi extraído para `rustPixelPocStyleInput.ts`,
sem alterar suas validações. Tanto serviço quanto agendador usam o mesmo
contrato de geometria, região, estilos/luz normalizados, texto, assets e PNG.
Objetos mutáveis são capturados antes da espera; Blobs imutáveis são emprestados.

Identidades iguais em camadas diferentes **não** podem compartilhar fonte por
acidente. O agendador compara exatamente o par consumidor/identidade original
e envia uma versão compacta ao serviço. Mantém só o último par despachado.
Chamadas consecutivas da mesma camada/fonte podem reutilizar o handle; alternar
A → B → A exige novo staging. Geometria, padding, escala e qualidade continuam
participando da chave da sessão. Não existe cache de fontes por camada.

O chamador ainda precisa mudar `sourceIdentity` quando pixels/texto mudarem.
Não é hash de conteúdo nem deduplicação automática de Blobs. A identidade
original continua limitada a 4.096 caracteres, mesmo enviada compactamente.

## 5. Orçamento conjunto e leases

Os limites do serviço são compartilhados por **toda a instância**:

| Parcela | Padrão |
| --- | --- |
| Reserva lógica agregada | 256 MiB, configurável de 96 a 512 MiB |
| Fase de processamento ativa | 96 MiB |
| PNGs entregues ainda em uso | 64 MiB e até 64 leases |
| Consumidores pendentes | 16, configurável até 64 |

Entradas cobram metadados estimados + Blob de origem + todos os Blobs de
padrões fornecidos + chave UTF-16 do consumidor. Mesmo Blob em pedidos distintos
é cobrado por pedido, conservadoramente. A identidade original é cobrada, não
apenas a curta enviada ao Worker. Quantidade de leases e PNGs não é por camada.

```text
processando: 96 MiB + entrada ativa + entradas da fila + PNGs com lease
drenagem já ociosa: fonte staged + entrada ainda ativa + fila + PNGs com lease
ocioso: fonte staged + fila + PNGs com lease
```

Admissão desconta a entrada pendente substituída e confere a reserva atual e
a fase futura. Antes de cada despacho há nova conferência: PNGs publicados
desde a admissão podem fazer o trabalho seguinte não caber. Publicação também
confere a fila agregada; resultado recusado é liberado, sem perder os anteriores.
Não há eviction de resultado que ainda tenha lease.

`stats` expõe ativo, quantidade de pendentes, `queuedInputBytes`, bytes da fonte,
PNGs retidos, leases, reserva lógica e estado terminal. Não expõe conteúdo,
URLs ou identidades editoriais. Após dispose, PNGs já entregues continuam
contabilizados, válidos e liberáveis com `release()` idempotente.

**Não é teto de RSS nem orçamento global do aplicativo.** A conta não cobre
metadados reais do heap, cópias temporárias do snapshot/structured clone,
memória WASM já crescida, alocações internas de browser/encoder, imagem intrínseca
antes do resize, fetch anterior ao agendamento, URLs/bitmaps de apresentação,
outras instâncias/janelas e processamento legado. Validação de tamanho do PNG
ocorre após encode, não impede a alocação anterior.

## 6. Falhas e fechamento

Falha de uma camada rejeita seu trabalho, sem esvaziar a fila. O próximo
consumidor pode recuperar sob demanda. A retomada espera confirmação de término
da conexão anterior antes de abrir outra. Factory que resolve após abort não
é adotada; factory deve respeitar abort para garantir limpeza de seus recursos.
Não existe retry automático infinito, um Worker por camada ou pool paralelo.

`dispose()` é terminal/idempotente: rejeita ativo e fila, aborta abertura,
termina o Worker e espera drenagem. Não espera encoder destravado nem factory
que ignore abort e nunca resolva. Não revoga resultados já publicados.

## 7. Aceite e próximo passo

A suíte cobre FIFO multicamadas, cancelamento isolado, rajadas, capacidade,
snapshots, alias/reuso de fontes, entrada inválida, orçamento conjunto, leases,
falha de abertura, watchdog, dispose e término físico retardado artificialmente.
O serviço tem teste específico de `whenIdle()` com encoder bloqueado.

Próxima fatia: integrar essa instância compartilhada ao preview opt-in, incluindo
preparação abortável/admissão antes de fetch, lifecycle de documento, circuito de
falha, métricas agregadas, URLs/handoff e smoke multicamadas Wails. Depois:
prioridades/visibilidade, cache/eviction, limites intrínsecos e medições/QA.
C0/C1/C2 continuam abertos; C3/C4 ainda não substituíram pilha/DOM/exportação.

## 8. Atualização da 25ª fatia — preparação e integração opt-in

`renderPrepared(consumerId, { inputBytes, prepare(signal) })` aceita uma função
de preparação capturada pelo chamador. `inputBytes` estima os metadados guardados
na fila (0 a 4 MiB), não inclui mídia ainda não buscada. O preview calcula essa
estimativa com o mesmo contador do serviço; estilos/texto/metadados acima do
limite e conflitos de assets falham antes de buscar mídia.

Antes de invocar o loader, cobra-se fonte staged + 128 MiB de reserva codificada
+ entrada de metadados + fila + PNGs com lease. A preparação é exclusiva, sem
fetches simultâneos de vários consumidores. Ao resolver, há snapshot/preflight
completo e troca da reserva pelos bytes reais de origem/padrões/metadados;
entrada ativa + 96 MiB + fila + PNGs precisam caber antes do despacho ao Worker.
`render` com mídia pronta continua compatível com a 24ª fatia.

Cancelamento aborta o loader e rejeita seu consumidor cedo, mas mantém o slot
até o loader terminar ou seu watchdog expirar. Preparação que não termina em
30 s encerra a instância e rejeita a fila; não libera um slot para começar outro
loader enquanto o antigo pode continuar alocando. Loader que ignore abort pode
continuar existindo externamente, mas nunca abre Worker/publica depois do timeout
ou dispose. Isso não é interrupção de código arbitrário nem teto de RSS.
Ao contrário do timeout de um trabalho do Worker, timeout de preparação é terminal.

Dispose interrompe a espera do loader, remove watchdog/listeners e espera
encerramento/drenagem do serviço. O código de timeout é preservado como
`wasm-unavailable`, inclusive quando abort faz o fetch rejeitar imediatamente.
O observador opcional de métricas recebe mudanças de fila/drenagem/releases;
exceção do observador não pode quebrar renderização ou impedir release.

A factory `createRustPixelPocStyleScheduler` usa o mesmo conector local/lazy de
`createRustPixelPocStyleService`. No preview, todos os consumidores do contexto
usam a mesma instância; limite conjunto de resultados inclui contextos retirados.
Os novos smokes Wails verificam três camadas, um Worker, remoção parcial, edição
isolada, fallback comum e zero leases/Workers após retirar o último consumidor.

## 9. Atualização da 26ª fatia — prioridades justas

`render(consumerId, input, { priority })` e
`renderPrepared(consumerId, preparation, { priority })` aceitam `active`, `visible`
ou `background`. O default é `visible`, mantendo FIFO para chamadores antigos.
`setPriority(consumerId, priority)` muda somente o pendente correspondente;
não cancela o ativo, não recaptura mídia e não altera orçamento, posição ou idade.
Consumidor desconhecido não cria estado. Nível inválido rejeita antes de loader/
Worker, sem cancelar pedido válido anterior. Demais invalidações mantêm o contrato.

Prioridade ordena pendentes; FIFO desempata. A cada despacho admitido, pedidos
anteriores ultrapassados envelhecem até três. O mais antigo com três ultrapassagens
ganha o próximo despacho, independentemente do nível. Substituir seu pedido
conserva a idade. Cancelar/retirar encerra aquela espera; reenfileirar ativo é uma
nova espera. Rejeição por orçamento não conta como despacho nem envelhece vizinhos.
O ativo não é preemptado por uma seleção diferente. Drenagem física, capacidade,
watchdogs, serialização de preparação, circuitos e leases não mudaram.

A idade limita ultrapassagens, não tempo absoluto. A fila continua sujeita aos
deadlines e orçamentos anteriores; não há processamento paralelo, prioridades
enviadas ao WASM ou mudança de ABI. O preview conserva prioridade durante abertura
lazy e encaminha mudanças à fila sem render novamente. O canvas calcula relevância
com geometria/halo conservadores; não suprime pedidos fora da tela. Camadas ocultas
continuam no lifecycle anterior de unmount. Cache/eviction, limites intrínsecos,
orçamento entre janelas, medições e QA ainda faltam. C0/C1/C2 continuam abertos.

## 10. Atualização da 27ª fatia — orçamento com cache externo

O [cache codificado do preview](contrato-cache-midia-preview-rust-v1.md) fica fora
do agendador. Sua capacidade de 32 MiB é descontada pela factory do preview,
que passa 224 MiB ao serviço, menos PNGs antigos. A fila continua cobrando os
Blobs emprestados como entrada, mesmo se também estiverem no cache; a conta
é conservadora. Cache não altera capacidade de fila, prioridades, drenagem,
watchdogs ou leases. `stats.reservedBytes` do agendador não inclui cache externo;
o diagnóstico do adaptador expõe seus bytes/capacidade separadamente.
Eviction não cancela pedido nem encerra Worker. Cache decodificado e orçamento
entre janelas continuam pendentes; esta atualização não fecha C0/C1/C2.
