# Inventário inicial de strings e fronteiras de tradução

Estado: parcial, atualizado em 2026-09-30. Este documento acompanha o
[roadmap do compositor e idiomas](roadmap-compositor-rust-internacionalizacao.md).
Não confundir catálogo existente com interface inteira traduzida.

| Classe | Exemplos no repositório | Tratamento |
| --- | --- | --- |
| UI, acessibilidade e dicas | `ProjectHome.vue`, `RecentProjectCard.vue`, `TopMenu.vue`, `App.vue`, janela de estilos e diálogos Vue | Chaves semânticas; traduzir texto visível, `aria-label`, `title`, `alt`, loading e estados vazios juntos. Não usar `v-html`. |
| Mensagens de operações e erros | `App.vue`, `frontend/src/editor/`, `frontend/src/services/` | Gradualmente substituir frases de fronteira por `{code, params}`; preservar detalhe técnico separado. Mensagem de usuário é localizada na UI. |
| Diálogos nativos | `app.go`, `project.go`, `export_upload.go` | Go deve receber rótulos traduzidos ou código estável; não presumir que traduzir só o Vue cobre o desktop. |
| Datas, números e ordenação | `RecentProjectCard.vue`, `App.vue`, `exportSettings.ts`, `mediaDocument.ts`, `layerStylePresets.ts` | `Intl` conforme locale da UI; parsing/serialização de valores documentais permanecem independentes do locale. Revisar cada `pt-BR` literal. |
| Dados persistidos | Nomes de documento/camada e presets gravados em `.axia` | Projetos antigos preservam nomes que já foram gravados, inclusive “Fundo” e outros padrões em português. Localizar apenas o rótulo ao criar um novo item quando a migração chegar ao fluxo. |
| Conteúdo do usuário | Texto em `TextLayerContent`, nomes renomeados pelo usuário, caminhos, metadados e assets | Nunca traduzir. Parâmetros entram em mensagens localizadas sem mudar seu valor. |
| Logs, protocolos e arquivos | Logs técnicos, IDs, formatos `.axia`, extensões, nomes de chave de API | Contratos estáveis; não usar frase localizada como identificador ou dado persistido. |
| Distribuição e ajuda | README, instalador, onboarding e documentação | Trilha editorial separada; não está coberta pelo catálogo do frontend. |

## Primeira fatia implementada

`frontend/src/i18n/catalogs.ts` contém 20 chaves de tela inicial e cartões de
projetos recentes em PT-BR, inglês e chinês simplificado **provisório**. Os
testes garantem mesma matriz de chaves, formas plurais e parâmetros nomeados.
`ProjectHome.vue` e `RecentProjectCard.vue` já aceitam uma prop `locale`; sem
essa prop, continuam em PT-BR. A data de modificação usa esse locale.

O menu superior (`TopMenu.vue`) passou a usar mais 54 chaves em
`frontend/src/i18n/menuCatalogs.ts`, incluindo tooltips, acessibilidade e as
variações singular/plural de estilos de camada. O catálogo oficial soma agora
74 chaves nessa etapa. A prop `locale` também é opcional nesse componente e mantém PT-BR
como padrão. Nomes de ações do histórico (`undoLabel`, `redoLabel`, itens de
histórico), `statusText` e formatação de bytes ainda vêm dos produtores atuais;
eles exigem migração própria antes de ativar outro idioma para o menu.

`NewDocumentDialog.vue` agora usa mais 54 chaves de
`frontend/src/i18n/documentCatalogs.ts` (128 no catálogo oficial). Rótulos,
ajuda, acessibilidade, unidades visíveis, estimativas e erros são exibidos no
locale da prop opcional; o padrão segue PT-BR. A validação devolve códigos
estáveis ao diálogo e `validateDocumentSettings` mantém as mensagens legadas
para os demais chamadores. IDs, unidades e fundos persistidos não mudaram.
Rótulos de predefinições internas são traduzidos pelo ID; nomes de presets
salvos pelo usuário nunca são traduzidos. O nome inicial `Sem título` permanece
em português por ser também um valor de projeto persistido; sua migração
precisa ser coordenada com todos os fluxos que criam documento/camada.
Os números de estimativas são formatados para exibição com `Intl`, mas os
valores dos campos e os cálculos de DPI não são alterados.

A frase do estado vazio que envolve `.axia` em `<code>` continua literal no
componente até haver uma solução de tradução com componente/slot, para não
transformar texto traduzido em HTML nem remover o destaque existente.
Ainda não há seletor e o SO **não** escolhe idioma para a UI: ativar isso agora
misturaria idiomas na mesma janela. A lista do SO já pode ser consultada por
`GetSystemLanguages`/`getSystemLanguages`, com fallback controlado ao WebView,
mas ainda não está conectada ao estado da janela. O texto chinês precisa de
revisão humana fluente antes de ser considerado pronto para lançamento.

## Próximos grupos para extração

1. Demais ações/estados da tela principal e fontes dos rótulos de histórico,
   com largura variável e sem deslocar o canvas; incluir atalhos e acessibilidade.
2. Diálogos de importação PDF/imagem, exportação e salvamento, incluindo erros
   nativos de Go e unidades/DPI. O diálogo de novo documento já foi extraído,
   mas ainda requer QA visual e integração do locale global.
3. Ferramentas, camadas, propriedades, estilos e janela separada de estilos.
4. Mensagens de seleção, rasterização, processamento em Worker e falhas.
5. Auditoria de literais novos, pseudolocalização, fontes CJK e QA manual.

Somente após fechar esses grupos: conectar a lista nativa e a preferência
manual/automática à interface e expor escolha de idioma. Validar os adaptadores
Linux/macOS nas plataformas alvo. Pacotes externos ficam na fase I2 e não
executam código.
