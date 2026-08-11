# Formato de projeto Axia

O arquivo `.axia` é um contêiner ZIP versionado. A versão inicial preserva o
documento editável sem armazenar caches ou previews derivados.

## Estrutura v1

```text
projeto.axia
├── manifest.json
└── assets/
    ├── asset-0001.png
    └── asset-0002.jpg
```

O manifesto identifica o formato com `"format": "axia"` e `"version": 1`.
Ele contém:

- propriedades e dimensões do documento;
- ordem, visibilidade e opacidade das camadas;
- textos editáveis e transformações;
- referências aos assets raster incorporados;
- guias, origem/unidade das réguas e estado visual do documento.

Cada fonte raster aparece uma única vez na lista `assets`, mesmo quando várias
camadas a reutilizam. `previewUrl`, resolução de preview e tokens internos de
edição nunca são persistidos: a engine os regenera conforme os pixels visíveis.

## Escrita e leitura

- Imagens PNG, JPEG e GIF são armazenadas sem uma segunda compressão ZIP.
- O frontend envia blobs editados como multipart, sem conversão para Base64.
- Assets já registrados no backend são copiados diretamente do arquivo-fonte.
- A escrita ocorre em arquivo temporário no mesmo diretório e termina com
  substituição atômica do destino.
- A leitura valida versão, caminhos, dimensões, MIME, quantidade e tamanho dos
  assets antes de disponibilizá-los à engine.

Versões futuras devem adicionar campos de forma compatível ou introduzir uma
nova versão acompanhada de migração explícita.
