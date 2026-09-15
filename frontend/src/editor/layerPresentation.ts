import type { LayerItem, LayerKind } from '../types/editor.ts'

const LAYER_KIND_LABELS: Record<LayerKind, string> = {
  pixel: 'Camada de pixels',
  image: 'Camada de pixels',
  text: 'Texto',
  shape: 'Forma vetorial',
  smart: 'Objeto inteligente',
  adjustment: 'Ajuste',
  background: 'Plano de fundo'
}

export function layerKindLabel(layer: Pick<LayerItem, 'kind'>) {
  return LAYER_KIND_LABELS[layer.kind]
}

export function layerKindHelp(layer: Pick<LayerItem, 'kind'>) {
  switch (layer.kind) {
    case 'smart':
      return 'Objeto inteligente — dê dois cliques na miniatura para editar o conteúdo'
    case 'shape':
      return 'Forma vetorial — mantém contornos editáveis ao redimensionar'
    case 'text':
      return 'Camada de texto editável'
    case 'background':
      return 'Plano de fundo do documento'
    case 'adjustment':
      return 'Ajuste não destrutivo aplicado às camadas abaixo'
    default:
      return 'Camada de pixels — permite pintura e edição direta'
  }
}

export function layerIsPixelBased(layer: Pick<LayerItem, 'kind'>) {
  return layer.kind === 'pixel' || layer.kind === 'image' || layer.kind === 'background'
}
