# Limites intrínsecos de mídia no preview Rust — V1

## 1. Escopo da 28ª fatia

O Worker do preview opt-in inspeciona dimensões **antes de chamar
`createImageBitmap`**. Pedir resize pequeno não garante que o decoder deixe de
abrir o raster original. A verificação usa bytes do Blob, não as dimensões
editoriais, a extensão ou o MIME informado.

`rustStyleImageHeader.ts` faz leitura bounded e parsing puro; `rustPixelPocMedia.ts`
aplica os limites nas fontes e nos padrões/texturas ativos. Texto continua com o
shaping/layout existente. Não há novo algoritmo Rust, alteração de ABI/`.axia`,
dependência, versão da stack ou mudança no compositor normal/exportação.

## 2. Cabeçalhos admitidos

| Formato | Dimensões verificadas |
| --- | --- |
| PNG | Assinatura completa, primeiro chunk IHDR com comprimento 13, largura/altura |
| GIF87a/GIF89a | Versão exata e logical screen width/height |
| JPEG | SOI e segmentos bounded até um SOF com tamanho coerente com os componentes |

JPEG sequencial/progressivo e os marcadores SOF definidos em T.81 são reconhecidos;
fill bytes/TEM são tratados. Não se procura SOF em bytes aleatórios ou dentro de
metadados. SOS/EOI antes de SOF, segmento incompleto, altura zero/DNL e cabeçalho
fora dos primeiros **256 KiB** falham sem leitura adicional/decode. Isso pode
rejeitar JPEG válido com metadados extensos: é restrição do experimento, não novo
limite do arquivo de documento.

PNG precisa do IHDR inteiro incluindo a posição do CRC, mas o helper **não valida
CRC, conteúdo de pixels ou o arquivo inteiro**. A decodificação real continua
sendo responsabilidade do browser. Cabeçalho truncado, assinatura/estrutura
desconhecida ou dimensão nula geram `invalid-input`. WebP/SVG/BMP/outros formatos
não ganham admissão implícita: usam o fallback existente. MIME incorreto/vazio não
impede um PNG/JPEG/GIF reconhecido pelos bytes.

Referências do parser: [PNG/IHDR](https://www.w3.org/TR/png-3/#11IHDR),
[GIF89a](https://www.w3.org/Graphics/GIF/spec-gif89a.txt),
[JPEG T.81](https://www.w3.org/Graphics/JPEG/itu-t81.pdf).

## 3. Orçamento e geometria

- Máximo intrínseco: **16.384 por eixo** e **64 MiB de RGBA lógico**
  (`width × height × 4`). Valores no limite são aceitos; produto não seguro ou
  acima do teto gera `memory-limit`, antes do decoder.
- Fonte: `intrinsicBytes + 3 × outputSourceBytes ≤ 96 MiB`. A conta conservadora
  inclui raster original, bitmap redimensionado, canvas e readback. A fonte
  anterior já foi retirada pelo staging. O limite anterior de padding
  (`sourceBytes + 2 × paddedBytes ≤ 96 MiB`) permanece independente.
- Padrões: a área do cabeçalho deve coincidir com a área declarada, com os eixos
  iguais ou trocados para permitir orientação EXIF. O bitmap **após decode** tem
  de coincidir exatamente com largura/altura do asset; isso não autoriza resize
  silencioso ou mudança da escala visual do padrão.
- O orçamento anterior de assets continua contando fonte staged + soma RGBA dos
  padrões + três vezes o maior padrão. Os cabeçalhos não permitem que uma textura
  enorme passe por se declarar como 1×1.
- O bitmap de fonte também precisa respeitar o resize solicitado. Decoder que
  devolve dimensões diferentes falha antes de criar canvas/readback.

São limites lógicos por trabalho, **não um teto de RSS nem um sandbox de imagens**.
Metadados podem ser malformados, o decoder nativo pode usar buffers adicionais,
profundidade de cor intermediária, frames de animação e cópias internas. Não há
garantia de memória física global ou proteção contra bugs do decoder. A leitura
adiciona até 256 KiB transitórios; não é cache de cabeçalhos/pixels decodificados.
O cache codificado continua reservado nos 256 MiB anteriores, sem elevar o teto.

## 4. Lifecycle e fallback

Antes/depois da leitura do cabeçalho e depois do decode, `ensureCurrent` impede
que um pedido antigo continue para canvas, upload ou publicação. Blob direto,
miss e hit do cache codificado passam pela mesma inspeção no Worker. Reuso da
fonte staged não repete decode/cabeçalho; nova fonte continua exigindo revisão.

Bitmap é fechado e canvas reduzido a 1×1 em sucesso, erro e obsolescência.
Falha de padrão não invalida a fonte staged nem envenena a fila. Staging de fonte
com falha consome sua geração; nova tentativa usa a próxima geração, preservando
as barreiras anteriores.

`invalid-input`/`memory-limit` são falhas locais: abrem o circuito da camada,
retiram sua fonte do cache e deixam outras camadas no mesmo Worker. Retirar e
remontar o consumidor permite nova tentativa. Indisponibilidade do backend
continua tendo o circuito global já existente. O diagnóstico browser agora
preserva a classe/código de erro do Worker, como o cliente de produção.

**Fallback não equivale a tornar seguro o decoder legado:** esta proteção é do
caminho Rust experimental. O compositor anterior mantém seus limites e consumo;
o preview normal e a importação não receberam promessa de memória limitada.

## 5. Validação e próximos passos

Testes puros cobrem formatos, MIME enganoso, prefixos truncados, segmentos,
limites inclusivos, SOF tardio e abort da leitura bounded. Doubles explícitos
exercitam ausência de decode/readback nas rejeições, limpeza, soma de orçamento,
eixos trocados e decoder que ignora resize. As fixtures incluem cabeçalho PNG
mais payload JSON de teste; não são PNGs completos nem validam o decoder nativo.

Worker/WASM reais exercitam recuperação de staging/padrões e fallback de uma
camada sem interromper outra. Diagnóstico Wails/WebView2 testa cabeçalho enorme/
desconhecido, recuperação com PNG real, padrão rejeitado sem perder a fonte,
JPEG real gerado pelo browser e GIF transparente real. JPEG usa tolerância
explícita para cor; não compara compressão com um golden byte a byte.

QA manual e RSS sob arquivos reais grandes continuam necessários. Próximas
fatias: medir decode, decidir cache decodificado apenas com evidência, coordenar
orçamento entre janelas e iniciar a pilha documental C3. C0/C1/C2 permanecem
abertos; canvas único C4/default/exportação não foram migrados nesta fatia.
