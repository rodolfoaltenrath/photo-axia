import type { LayerItem, LayerKind } from '../types/editor.ts'

const LAYER_KIND_LABELS: Record<LayerKind, string> = {
  pixel: 'Camada rasterizada',
  text: 'Texto',
  shape: 'Forma',
  smart: 'Objeto inteligente',
  adjustment: 'Ajuste',
  background: 'Fundo'
}

export function layerKindLabel(layer: Pick<LayerItem, 'kind'>) {
  return LAYER_KIND_LABELS[layer.kind]
}

export function layerKindHelp(layer: Pick<LayerItem, 'kind'>) {
  switch (layer.kind) {
    case 'smart':
      return 'Objeto Inteligente: preserva o original ao redimensionar. Dê dois cliques na miniatura para editar o conteúdo.'
    case 'shape':
      return 'Forma vetorial: cor, contorno e arredondamento continuam editáveis.'
    case 'text':
      return 'Texto: conteúdo, fonte, tamanho e cor continuam editáveis.'
    case 'background':
      return 'Plano de fundo do documento.'
    case 'adjustment':
      return 'Ajuste não destrutivo aplicado às camadas abaixo.'
    default:
      return 'Camada de pixels: permite pintar, apagar e preencher diretamente.'
  }
}

export function layerIsPixelBased(layer: Pick<LayerItem, 'kind'>) {
  return layer.kind === 'pixel' || layer.kind === 'background'
}
