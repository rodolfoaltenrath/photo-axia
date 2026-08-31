# Roadmap — Abrir imagem ou PDF como documento

## Objetivo

Permitir que uma imagem existente ou uma página de PDF seja a origem de um novo documento, preservando exatamente as dimensões em pixels do raster e sem confundir esse fluxo com a adição de camadas ao documento atual.

## Comportamento definido

- `Abrir imagem como documento…` cria um documento com as dimensões nativas da imagem.
- `Abrir PDF como documento…` usa a página, a resolução e o fundo escolhidos na janela de PDF; o raster resultante define as dimensões exatas do documento.
- O documento aberto contém somente uma camada, posicionada em `X = 0` e `Y = 0`, sem redimensionamento ou reamostragem.
- A transparência da imagem ou da página renderizada é preservada.
- O nome do arquivo é usado como nome inicial do documento e da camada.
- Quando existir resolução válida no arquivo, ela é usada como resolução física do documento. A ausência de metadado não altera os pixels; apenas aplica o padrão interno de 72 ppi ao documento.
- Abrir uma mídia inicia um histórico limpo. A primeira edição torna o documento não salvo.
- Se houver alterações não salvas, o usuário escolhe salvar, descartar ou cancelar antes de iniciar a abertura.
- Cancelar o seletor, falhar a leitura ou cancelar a janela de PDF não destrói o documento atual.
- No editor, arrastar mídia continua adicionando-a como camada. Na tela inicial, arrastar uma imagem ou PDF abre a mídia como documento.
- Permanecem os limites de segurança atuais: no máximo 16.384 px por eixo e 64 megapixels para o raster final.
- GIF é convertido de forma determinística para o primeiro quadro; animação não faz parte do editor raster atual.
- A tela inicial abre somente uma imagem como documento. Imagens adicionais no mesmo arraste são recusadas com uma explicação, sem serem transformadas em camadas implicitamente.
- Dentro de um documento, várias imagens adicionadas por arraste ou pelo seletor formam uma fila: cada item é posicionado pela Transformação Livre antes de avançar.
- Não haverá limite arbitrário pelo tamanho comprimido da imagem; os limites continuam baseados nas dimensões e na memória do raster.

## Etapas

- [x] Mapear criação de documento, ciclo de assets, histórico, proteção de alterações e importações existentes.
- [x] Definir os contratos de abertura transacional e a separação entre “abrir” e “adicionar como camada”.
- [x] Criar helpers testáveis para nome, resolução, validação e camada nativa.
- [x] Implementar abertura de uma imagem como documento no navegador e no desktop.
- [x] Adaptar o diálogo de PDF para abrir a página escolhida como documento.
- [x] Reorganizar o menu Arquivo e as ações da tela inicial com linguagem explícita.
- [x] Implementar o comportamento contextual de arrastar e soltar.
- [x] Cobrir os fluxos e casos-limite com testes automatizados.
- [x] Validar TypeScript, testes, Go, Vite e gerar `bin/axia.exe`.
- [x] Normalizar GIF para o primeiro quadro e corrigir orientação EXIF nas prévias nativas.
- [x] Tornar imagens nativas independentes do arquivo original e liberar seus recursos explicitamente.
- [x] Eliminar a decodificação duplicada durante a abertura transacional.
- [x] Preservar fundo e nome coerentes ao abrir PDF como documento.
- [x] Implementar fila de posicionamento com confirmar, cancelar item e cancelar fila.
- [x] Cobrir as correções da revisão com testes e gerar novo executável.

## Registro de implementação

### 2026-08-28 — Análise e contrato

- Confirmado que a importação atual centraliza metadados em `ImportedImage`, incluindo dimensões, MIME, URL e resolução opcional.
- Confirmado que a importação como camada reduz imagens maiores para caber no documento; esse comportamento não será reutilizado ao abrir como documento.
- Confirmado que `history.clear()` e `savedHistoryRevision` controlam a linha de base limpa, e que o diálogo existente protege alterações não salvas.
- Definida a preparação da nova camada antes da troca de estado, para evitar perda do documento atual em falhas de preview ou decodificação.
- Definido que o seletor de imagem para documento aceitará somente um arquivo; a importação como camadas continuará aceitando múltiplos arquivos.

### 2026-08-28 — Implementação

- Criado `mediaDocument.ts` para centralizar resolução física, limites do editor, configuração do documento e construção da camada no tamanho nativo.
- Adicionado ao backend Wails um seletor de imagem de arquivo único e regenerado o binding TypeScript correspondente.
- Implementada a troca transacional: dimensão, documento e fonte visual são validados antes de liberar os assets do documento atual.
- A abertura inicia uma linha de histórico limpa, remove seleção e guias, volta à ferramenta Mover, posiciona a camada em `(0, 0)` e mantém o raster sem reamostragem.
- O PDF agora carrega um destino explícito (`documento` ou `camada`) e reutiliza o mesmo diálogo de página, DPI e fundo sem duplicar o renderizador.
- O diálogo de PDF adapta título, instrução e ações ao destino escolhido.
- O menu Arquivo passou a separar claramente abrir mídia como documento de adicionar mídia como camada.
- A tela inicial ganhou ações diretas para imagem e PDF e aceita arquivos arrastados; dentro do editor, o arraste conserva o comportamento de adicionar camada.
- Arquivos adicionais em um arraste de abertura são ignorados com uma mensagem clara, pois o editor mantém um documento ativo por janela.

### 2026-08-28 — Revisão e validação automatizada

- Adicionados testes para dimensões nativas, origem da camada, preservação de metadados de resolução, fallback somente no documento e limites de dimensão/megapixels.
- Corrigida durante a revisão uma validação tolerante a erro: uma fonte visual inválida agora aborta antes da substituição do documento atual.
- `npm test`: 335 testes aprovados.
- Testes focados de mídia, imagem e PDF: 13 aprovados.
- `go test ./...`: aprovado.
- `vue-tsc`, Vite 8 e build de produção Wails: aprovados.
- Executável atualizado em `bin/axia.exe`.

### 2026-08-28 — Auditoria posterior e decisões

- Identificada divergência entre dimensões EXIF e a prévia Go, que ainda não aplicava rotação ou espelhamento.
- Identificada dependência do caminho original no desktop e ausência de liberação individual dos imports nativos.
- Identificado pico evitável de memória causado pela validação integral seguida de nova decodificação para preview.
- Definido que GIF será congelado no primeiro quadro e armazenado como PNG estático, preservando transparência.
- Definida fila semelhante ao posicionamento sequencial dentro de um documento existente: `Enter`, botão Aplicar ou clique fora da caixa confirma; `Esc` cancela somente o item atual; uma ação explícita cancela o restante.
- Definido que cada imagem adicionada entra centralizada, em tamanho real quando couber ou proporcionalmente ajustada quando for maior que o documento.
- Mantido o critério de segurança por dimensão, megapixels e memória descompactada, sem rejeitar uma imagem somente pelo tamanho do arquivo comprimido.

### 2026-08-31 — Fechamento das correções e fila de posicionamento

- GIF passa a ser congelado no primeiro quadro como PNG estático tanto no navegador quanto no backend desktop; o nome original continua visível para o usuário.
- Prévias JPEG nativas aplicam as oito orientações EXIF por uma visão coordenada do raster, evitando alocar uma segunda imagem integral somente para girar ou espelhar.
- Imports do desktop são copiados para uma pasta temporária gerenciada. A edição não depende mais de o arquivo original continuar no mesmo caminho.
- Assets nativos possuem liberação explícita e permanecem retidos enquanto forem alcançáveis pelo documento ou pelo histórico de desfazer/refazer.
- A abertura transacional gera e valida diretamente a prévia usada pelo editor, removendo a decodificação integral redundante e limpando a prévia destacada caso a troca falhe.
- Nome de exportação agora remove também as extensões de origem `.pdf` e `.gif`; o documento criado de um PDF conserva o fundo branco ou transparente escolhido.
- Ao adicionar imagens dentro do editor, por arraste ou pelo seletor, elas são preparadas uma por vez, centralizadas e ajustadas proporcionalmente somente quando excedem o documento.
- `Enter`, Aplicar ou clique fora da caixa confirma o item; `Esc` cancela somente o atual; `Cancelar todas` encerra os itens pendentes. Cada confirmação entra como uma única ação atômica no histórico.
- Menus, painéis, drops concorrentes e atalhos destrutivos ficam suspensos durante a fila, sem bloquear a interação da própria Transformação Livre.
- `go test ./...`: aprovado.
- Testes do frontend: 336 aprovados.
- `vue-tsc`, Vite 8 em desenvolvimento e Vite 8 em produção: aprovados.
- Novo executável de produção gerado em `bin/axia.exe`.

### 2026-08-31 — Correção de contexto da fila

- A fila foi removida da tela inicial: abrir mídia e adicionar camadas voltaram a ser ações semanticamente distintas.
- Um arraste na tela inicial abre apenas a primeira imagem como documento e informa por que as demais não foram abertas.
- Arrastar uma ou várias imagens sobre um documento existente agora inicia a fila de posicionamento.
- O comando `Adicionar imagens como camadas…` aceita seleção múltipla e usa exatamente a mesma fila.
- O cancelamento durante a preparação assíncrona foi protegido para não inserir uma camada depois que a fila já tiver sido encerrada nem liberar uma fonte ainda em decodificação.
- `vue-tsc`, builds Vite de desenvolvimento e produção: aprovados.
- Testes do frontend: 336 aprovados; `go test ./...`: aprovado.
- `bin/axia.exe` recompilado com o contexto corrigido da fila.

## Validação manual posterior

- Imagem PNG transparente, JPEG com e sem metadado de resolução e GIF suportado.
- PDF com fundo branco e transparente, diferentes páginas e resoluções.
- Salvar, descartar e cancelar ao substituir um documento alterado.
- Cancelamento dos seletores sem perder o documento atual.
- Arrastar mídia na tela inicial e no editor.
- Arrastar duas ou mais imagens sobre um documento; confirmar uma por `Enter`, outra clicando fora da caixa, cancelar um item com `Esc` e cancelar o restante pelo aviso superior.
- Arrastar várias imagens na tela inicial e confirmar que somente a primeira abre como documento, sem criar camadas adicionais.
- GIF animado com transparência e JPEG de celular com orientação EXIF.
