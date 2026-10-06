# Agendador compartilhado de estilos Rust — V1

## 1. Escopo da 24ª fatia

`frontend/src/editor/rustPixelPocStyleScheduler.ts` permite que consumidores
distintos usem **um serviço compartilhado**, com um Worker adotado por vez e
um slot de fonte. É a base isolada para ampliar o preview experimental, não
essa ampliação já ativada. A factory browser e o preview da 23ª fatia continuam
com um dono por janela. Não houve mudança no compositor documental, texto,
exportação, histórico, `.axia`, idioma, ABI, algoritmos Rust ou versões da stack.

O agendador recebe mídia já preparada, não loaders/fetches. Os testes passam
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
