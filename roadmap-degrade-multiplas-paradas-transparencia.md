# Roadmap — Degradê com múltiplas paradas e transparência

> Documento vivo de implementação do Axia. Atualizar este arquivo na mesma alteração
> de código sempre que uma fase avançar, mudar de escopo ou encontrar um bloqueio.

## Metadados

- Criação: 2026-08-25
- Estado geral: `NÃO INICIADO`
- Prioridade: após a validação e estabilização das ferramentas de seleção atuais
- Plataformas obrigatórias: Windows e Linux
- Dependências funcionais: Degradê linear/radial, cores principal/secundária,
  preview raster, worker/fallback, seleção e histórico
- Limite inicial: até 32 paradas de cor e 32 paradas de opacidade

## Objetivo

Evoluir a ferramenta Degradê de duas cores fixas para um editor de múltiplas paradas,
seguindo o modelo conhecido do Photoshop:

- paradas de cor controlam a interpolação RGB;
- paradas de opacidade controlam o alfa independentemente;
- qualquer posição pode ficar parcial ou totalmente transparente;
- preview interativo, worker e fallback produzem os mesmos pixels;
- degradês atuais continuam funcionando sem configuração ou migração manual.

O nome adotado na interface será **Pontos do degradê**. No código e na documentação
técnica, os termos serão `colorStops` e `opacityStops`.

## Protocolo obrigatório

1. Ler este roadmap completo e conferir `git status --short`.
2. Preservar mudanças pendentes e revisar o código atual antes de cada fase.
3. Marcar a fase como `EM ANDAMENTO` antes da primeira alteração material.
4. Implementar modelo e testes puros antes da interface.
5. Manter preview, worker e fallback apoiados no mesmo núcleo de interpolação.
6. Atualizar testes, documentação e este roadmap em cada incremento.
7. Não marcar uma fase como concluída sem os critérios automatizados e manuais dela.

Estados permitidos: `NÃO INICIADO`, `EM ANDAMENTO`,
`IMPLEMENTADO, AGUARDANDO VALIDAÇÃO`, `BLOQUEADO` e `CONCLUÍDO`.

## Baseline confirmado

- `GradientConfig` contém tipo, cor principal, cor secundária e inversão.
- O gesto linear/radial e sua geometria já são estáveis.
- A prévia usa `CanvasGradient`; o resultado final usa interpolação própria no raster.
- O processamento definitivo possui worker, fallback, cancelamento e lotes por linha.
- Seleções vetoriais e raster limitam corretamente a aplicação.
- A troca visual entre preview e raster final já aguarda o próximo frame.
- Estilos de camada já possuem um modelo separado com `colorStops` e `opacityStops`;
  ele serve como referência, mas não deve ser acoplado diretamente sem normalização.

## Decisões de produto

1. Cor e opacidade terão trilhas independentes, como no Photoshop.
2. Toda configuração válida terá ao menos duas paradas de cor.
3. Opacidade sem paradas válidas será normalizada para 100% nas duas extremidades.
4. Posições usam intervalo normalizado de `0` a `1`.
5. Interpolação de cor permanece sRGB na primeira versão.
6. Interpolação de opacidade é linear e aplicada ao alfa resultante.
7. Inverter espelha posições (`1 - posição`) e mantém todos os valores.
8. Transparência significa alfa real no raster, não mistura com branco ou fundo.
9. Paradas das extremidades podem ser editadas, mas não removidas se isso deixar menos
   de duas paradas de cor.
10. Novas paradas recebem o valor interpolado exatamente na posição de inserção.
11. A configuração vive na sessão do editor; persistência em presets fica para fase
    posterior explicitamente aprovada.

## Modelo de dados proposto

```ts
interface GradientColorStop {
  id: string
  position: number
  color: string
}

interface GradientOpacityStop {
  id: string
  position: number
  opacity: number // 0..100
}

interface GradientConfig {
  type: 'linear' | 'radial'
  colorStops: GradientColorStop[]
  opacityStops: GradientOpacityStop[]
  reversed: boolean
  interpolation: 'srgb'
}
```

IDs pertencem à interface e ao histórico de edição, mas não participam do cálculo de
pixels. O núcleo deve ordenar cópias normalizadas sem reordenar arrays reativos durante
um gesto.

## Migração e compatibilidade

- O estado atual preto→branco vira duas paradas nas posições `0` e `1`.
- Cor principal e secundária continuam alimentando as extremidades do preset padrão.
- Chamadas ou testes antigos que ainda entreguem `foregroundColor` e
  `backgroundColor` serão normalizados temporariamente no limite do motor.
- A migração deve ser removida somente após todos os consumidores internos adotarem o
  novo contrato e os testes comprovarem equivalência pixel a pixel.
- Projetos `.axia` atuais não são afetados porque a configuração da ferramenta ainda
  não é persistida no documento.

## Experiência do usuário

### Faixa do degradê

- Exibir uma faixa sobre padrão xadrez para tornar transparência visível.
- Paradas de opacidade ficam acima; paradas de cor, abaixo.
- Clique em uma trilha adiciona uma parada na posição apontada.
- Clique em um marcador seleciona; arraste horizontal altera a posição.
- Posição pode ser ajustada numericamente de 0% a 100%.
- Marcador selecionado recebe foco e indicação visual inequívoca.

### Edição

- Parada de cor: seletor de cor, posição e botão Remover.
- Parada de opacidade: controle de 0% a 100%, posição e botão Remover.
- `Delete` remove a parada ativa somente quando o foco está no editor.
- Setas movem a parada em 1%; `Shift` + setas, em 10%.
- Duplo clique no marcador abre o controle principal correspondente.
- O botão Inverter espelha a configuração completa.

### Descoberta para usuários leigos

- A barra contextual mostra uma miniatura clicável e o texto “Editar degradê”.
- O editor explica “Clique na faixa para adicionar um ponto”.
- Transparência será apresentada como “Opacidade”, evitando exigir conhecimento de alfa.
- Controles possuem rótulos, tooltips e valores visíveis, não apenas ícones.

## Fases

### Fase 0 — Contrato, normalização e fixtures

Estado: `NÃO INICIADO`

- Criar tipos próprios da ferramenta e limites formais.
- Normalizar posições, cores, opacidades, ordem e IDs duplicados.
- Garantir cópias independentes para objetos reativos e `postMessage`.
- Criar fixtures com 2, 3, 8 e 32 paradas, posições coincidentes e transparência.

Aceite: entradas inválidas nunca produzem `NaN`, arrays vazios ou menos de duas cores.

### Fase 1 — Interpolação compartilhada

Estado: `NÃO INICIADO`

- Localizar os vizinhos por busca ordenada.
- Interpolar RGB e opacidade separadamente.
- Definir comportamento determinístico para paradas na mesma posição.
- Preservar clamp antes da primeira e depois da última parada.
- Validar inversão por espelhamento da posição.

Aceite: tabelas de pixels esperados passam para linear, radial, alfa parcial e zero.

### Fase 2 — Raster, worker e fallback

Estado: `NÃO INICIADO`

- Propagar o novo config até `gradientRaster`, serviço e worker.
- Enviar snapshots clonáveis, nunca proxies Vue.
- Pré-calcular segmentos por lote para evitar busca completa por pixel.
- Manter cancelamento, orçamento da prévia e expansão raster existentes.
- Confirmar equivalência entre processamento integral, em lotes e worker.

Aceite: resultado idêntico nos três caminhos e sem regressão relevante no benchmark 4K.

### Fase 3 — Preview interativo

Estado: `NÃO INICIADO`

- Adicionar todas as paradas de cor e alfa ao preview.
- Quando `CanvasGradient` não representar exatamente o modelo combinado, gerar uma
  LUT compartilhada ou preview raster para manter fidelidade com o resultado final.
- Preservar máscara de seleção, zoom, DPR e handoff sem piscada.

Aceite: matriz visual de posições 0/25/50/75/100%, transparência e inversão coincide
com o raster final.

### Fase 4 — Editor visual de paradas

Estado: `NÃO INICIADO`

- Criar componente isolado para faixa, marcadores e propriedades.
- Implementar adicionar, selecionar, mover, editar e remover.
- Fechar ao clicar fora sem conflitar com toolbar, réguas ou atalhos do canvas.
- Tratar teclado, foco, leitores de tela e alvos mínimos de ponteiro.

Aceite: fluxo completo funciona por mouse e teclado sem perder a configuração.

### Fase 5 — Integração e compatibilidade

Estado: `NÃO INICIADO`

- Substituir os dois campos implícitos pelo novo estado no `App` e contratos do canvas.
- Manter as cores principal/secundária no preset padrão.
- Garantir que trocar tipo, ferramenta, camada ou documento cancele somente o gesto.
- Manter uma única entrada de histórico por aplicação.

Aceite: degradês antigos continuam visualmente idênticos e múltiplas paradas funcionam
com retângulo, elipse, laço e seleção raster transformada.

### Fase 6 — Validação, desempenho e documentação

Estado: `NÃO INICIADO`

- Rodar testes frontend, TypeScript, Vite, Go e builds Windows/Linux.
- Medir preview e aplicação 4K com 2, 8 e 32 paradas.
- Testar documentos transparentes e camadas rotacionadas/escaladas.
- Atualizar README, atalhos e ajuda contextual.
- Registrar resultados manuais e limitações restantes.

Aceite: sem divergência visual conhecida, vazamento de URLs, bloqueio perceptível da UI
ou regressão nos projetos existentes.

## Testes automatizados obrigatórios

- normalização, clonagem e ordenação;
- equivalência exata do caso legado de duas cores;
- interpolação com três ou mais cores;
- opacidade 100→0, 0→100 e múltiplos picos;
- paradas coincidentes e posições fracionárias;
- inversão dupla retorna ao resultado original;
- linear e radial;
- seleção vetorial e raster transformada;
- worker/fallback/lotes equivalentes;
- cancelamento e no-op;
- limite de 32 paradas e payload clonável;
- interação do editor: adicionar, mover, remover e teclado.

## Validação manual obrigatória

### Windows

- Criar degradê de 3, 8 e 32 cores.
- Criar transição cor→transparente→cor.
- Arrastar marcadores rapidamente e aplicar em imagem 4K.
- Testar seleção retangular, elíptica, laço e Varinha.
- Testar desfazer/refazer, troca de camada, cancelamento e reinstalação.

### Linux

- Repetir criação, transparência, aplicação e histórico no Flatpak.
- Conferir seletores de cor, foco, escala de interface e performance do WebKitGTK.

## Riscos e mitigação

- Divergência CanvasGradient/raster: usar núcleo/LUT compartilhado no preview.
- Busca cara por parada a cada pixel: pré-calcular LUT ou cursor de segmento.
- Muitos eventos ao arrastar: coalescer com `requestAnimationFrame`.
- Proxies em worker: snapshot explícito na fronteira.
- Marcadores sobrepostos: seleção por ordem visual e edição numérica.
- Transparência imperceptível: faixa xadrez e valor de opacidade explícito.
- Estado excessivo no `App.vue`: componente e módulo de domínio próprios.

## Fora do escopo inicial

- interpolação perceptual Lab/OKLab;
- midpoint ajustável entre duas paradas;
- ruído/dithering configurável;
- presets persistidos, importação/exportação de `.grd`;
- degradês angulares, refletidos ou diamante;
- edição não destrutiva como camada de preenchimento.

## Registro de decisões

| Data | Decisão | Motivo |
| --- | --- | --- |
| 2026-08-25 | Separar cor e opacidade | Reproduz transparência real e o modelo conhecido do Photoshop |
| 2026-08-25 | Limitar cada trilha a 32 paradas | Evita payload/UI sem limite e já cobre composições complexas |
| 2026-08-25 | Preservar sRGB inicialmente | Mantém equivalência com o motor atual e limita o escopo |
| 2026-08-25 | Não persistir presets no primeiro ciclo | A ferramenta ainda não possui configuração serializada no projeto |

## Registro de evolução

### 2026-08-25 — Roadmap criado

- Confirmado o nome “pontos de parada do degradê”.
- Definidas trilhas independentes de cor e opacidade, incluindo transparência total.
- Mapeadas migração, editor, preview, worker, fallback, testes e validação multiplataforma.
- Nenhum código funcional do Degradê foi alterado nesta etapa.
- Próximo passo exato: iniciar a Fase 0 com tipos, normalização e fixtures puras.
