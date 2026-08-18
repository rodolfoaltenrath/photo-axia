# Formato de projeto Axia

O arquivo `.axia` é um contêiner ZIP versionado. O backend lê as versões 1 e 2;
novos projetos são gravados na versão 2.

## Estrutura v2

```text
projeto.axia
├── manifest.json
└── assets/
    ├── asset-0001.png
    └── asset-0002.jpg
```

O manifesto identifica o formato com `"format": "axia"` e `"version": 2`.
Ele contém:

- propriedades e dimensões do documento;
- ordem, visibilidade, opacidade e modo de mesclagem das camadas;
- textos editáveis e transformações;
- referências aos assets raster incorporados;
- guias, origem/unidade das réguas e estado visual do documento.

Camadas inteligentes usam `kind: "smart"` e armazenam em `smart` um documento
interno com dimensões, resolução, espaço de cor, luz global, revisão e uma lista
recursiva de camadas. A profundidade máxima é de oito níveis. O `image` do
invólucro é um cache PNG derivado em memória; `smart.layers` continua sendo a
fonte de verdade editável.

A árvore completa aceita até 10.000 camadas, somando o documento principal e
todos os conteúdos inteligentes. IDs de camada precisam ser únicos dentro de
cada documento interno; estruturas cíclicas e árvores acima desses limites são
rejeitadas antes da gravação.

Cada fonte raster aparece uma única vez na lista `assets`, mesmo quando várias
camadas a reutilizam. `previewUrl`, resolução de preview e tokens internos de
edição nunca são persistidos: a engine os regenera conforme os pixels visíveis.
O cache de uma camada inteligente não é incorporado ao `.axia`: ele é regenerado
e limitado por orçamento de memória durante a abertura do projeto.

## Escrita e leitura

- Imagens PNG, JPEG e GIF são armazenadas sem uma segunda compressão ZIP.
- O frontend envia blobs editados como multipart, sem conversão para Base64.
- Assets já registrados no backend são copiados diretamente do arquivo-fonte.
- A escrita ocorre em arquivo temporário no mesmo diretório e termina com
  substituição atômica do destino.
- A leitura valida versão, caminhos, dimensões, MIME, quantidade e tamanho dos
  assets antes de disponibilizá-los à engine.

Projetos v1 são migrados em memória durante a abertura. Versões futuras devem
adicionar campos de forma compatível ou introduzir uma nova migração explícita.

O campo `blendMode` foi adicionado de forma retrocompatível à versão 1. Quando
ausente ou desconhecido, a camada é restaurada em `normal`.
