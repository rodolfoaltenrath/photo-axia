# Roadmap da movimentação de múltiplas camadas

> Registro vivo da correção do comportamento da ferramenta Mover quando mais de uma
> camada está selecionada.

## Objetivo

Fazer a ferramenta Mover tratar a seleção de camadas como um grupo temporário: todas
as camadas selecionadas e elegíveis recebem exatamente o mesmo deslocamento, mantendo
suas posições relativas, dimensões e rotações individuais.

## Comportamento aprovado

- Arrastar qualquer camada que já faça parte da seleção múltipla preserva a seleção e
  movimenta o grupo inteiro.
- Com seleção automática habilitada, arrastar uma camada fora da seleção substitui o
  grupo e movimenta somente a nova camada escolhida.
- Camadas ocultas ou sem transformação não participam do gesto.
- As setas do teclado seguem o mesmo comportamento coletivo da ferramenta Mover.
- O deslocamento de todas as camadas é registrado como uma única ação no histórico;
  `Ctrl+Z` e `Ctrl+Shift+Z` desfazem e refazem o grupo de forma atômica.

## Implementação — 2026-08-26

1. Identificado que o arrasto comum ainda mantinha apenas um `layerId`, enquanto a
   transformação livre (`Ctrl+T`) já possuía uma sessão com vários membros.
2. A sessão de arrasto passou a guardar todos os membros selecionados, seus estados
   originais e previews independentes.
3. O deslocamento calculado e ajustado pelo snapping da camada âncora passou a ser
   aplicado igualmente a todos os membros por `applyGroupMove`.
4. O clique numa camada já selecionada deixou de reduzir a seleção múltipla.
5. O deslocamento por teclado foi alinhado ao mesmo modelo de grupo.
6. Criado o delta de histórico `layers:transform`, específico para alterações
   geométricas atômicas em várias camadas e sem duplicar os assets raster na memória.
7. Adicionados testes de regressão para preservação do grupo, troca do alvo e
   desfazer/refazer coletivo.

### Correção de regressão — 2026-08-26

- A validação manual revelou que um grupo movimentado durante uma sessão de
  transformação livre ainda era confirmado por camada, criando duas entradas no
  histórico.
- A confirmação do `Ctrl+T` agora detecta quando houve somente deslocamento e envia
  todas as camadas pelo mesmo contrato atômico usado pela ferramenta Mover.
- O teste de histórico passou a registrar a ação real, executar um único `undo` e
  comprovar que esse único passo contém e restaura as duas transformações.

## Validação

- [x] Testes direcionados da seleção do grupo e do histórico atômico.
- [x] Verificação TypeScript com `vue-tsc --noEmit`.
- [x] Suíte completa do frontend: 269 testes aprovados.
- [x] Build de produção do frontend com Vite 8.
- [x] `go test ./...` e `go vet ./...` com Go 1.26.5.
- [ ] Validação manual no aplicativo instalado.

## Preferência e seleção temporária — 2026-08-27

1. A opção `Seleção automática` passou a ser uma preferência global persistida no
   armazenamento local do aplicativo, usando a chave `axia:auto-select-layer`.
2. Na primeira execução, ou se o armazenamento estiver indisponível, o comportamento
   continua sendo ligado por padrão.
3. Trocar de documento ou entrar em conteúdo inteligente não redefine mais a opção;
   a última decisão do usuário permanece ativa também após fechar e reabrir o Axia.
4. Com a opção desligada, o clique normal continua movendo a camada ativa.
5. `Ctrl+clique` ativa a seleção automática somente durante aquele gesto: escolhe a
   camada visível atingida pelo ponteiro e permite arrastá-la sem marcar a preferência.
6. Se houver uma seleção de pixels, `Ctrl+clique` prioriza a escolha da camada; o clique
   normal continua reservado ao movimento dos pixels selecionados.
7. Foram adicionados testes para valor padrão, restauração, gravação, armazenamento
   bloqueado e seleção automática temporária pelo modificador `Ctrl`.
8. Validação automática concluída com 302 testes frontend, verificação TypeScript,
   build Vite de produção, `go test ./...`, `go vet ./...` e `git diff --check`.
