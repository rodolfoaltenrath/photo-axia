import type { OFFICIAL_LOCALES } from './locale.ts'
import { menuEnUS, menuPtBR, menuZhHans } from './menuCatalogs.ts'
import { documentEnUS, documentPtBR, documentZhHans } from './documentCatalogs.ts'

export type OfficialLocale = (typeof OFFICIAL_LOCALES)[number]
export type MessageTemplate = string | Readonly<{ one: string; other: string }>
export type MessageParams = Readonly<Record<string, string | number>>

// First catalog slice. zh-Hans requires review by a fluent speaker before release.
const enUS = {
  ...menuEnUS,
  ...documentEnUS,
  'home.actions.label': 'Project actions',
  'home.actions.new': 'New',
  'home.actions.openProject': 'Open project',
  'home.actions.openImage': 'Open image',
  'home.actions.openPdf': 'Open PDF',
  'home.actions.returnToEditor': 'Return to editor',
  'home.recent.subtitle': 'Pick up where you left off',
  'home.recent.title': 'Recent projects',
  'home.recent.clear': 'Clear history',
  'home.recent.loading': 'Loading recent projects',
  'home.recent.emptyTitle': 'No recent projects',
  'home.recent.emptyDescription': 'Create a document, open a .axia project, or drag an image or PDF here.',
  'home.recent.count': { one: '{count} recent project', other: '{count} recent projects' },
  'recent.dateUnavailable': 'Date unavailable',
  'recent.fileMissing': 'File not found',
  'recent.open': 'Open {path}',
  'recent.fileMissingAtPath': 'File not found: {path}',
  'recent.thumbnailAlt': 'Thumbnail of {name}',
  'recent.removeAria': 'Remove {name} from recent projects',
  'recent.removeTitle': 'Remove from recent projects (the file will not be deleted)'
} as const satisfies Record<string, MessageTemplate>

export type MessageKey = keyof typeof enUS

const ptBR = {
  ...menuPtBR,
  ...documentPtBR,
  'home.actions.label': 'Ações de projeto',
  'home.actions.new': 'Novo',
  'home.actions.openProject': 'Abrir projeto',
  'home.actions.openImage': 'Abrir imagem',
  'home.actions.openPdf': 'Abrir PDF',
  'home.actions.returnToEditor': 'Voltar ao editor',
  'home.recent.subtitle': 'Continue de onde parou',
  'home.recent.title': 'Projetos recentes',
  'home.recent.clear': 'Limpar histórico',
  'home.recent.loading': 'Carregando projetos recentes',
  'home.recent.emptyTitle': 'Nenhum projeto recente',
  'home.recent.emptyDescription': 'Crie um documento, abra um projeto .axia ou arraste uma imagem ou PDF para esta tela.',
  'home.recent.count': { one: '{count} projeto recente', other: '{count} projetos recentes' },
  'recent.dateUnavailable': 'Data indisponível',
  'recent.fileMissing': 'Arquivo não encontrado',
  'recent.open': 'Abrir {path}',
  'recent.fileMissingAtPath': 'Arquivo não encontrado: {path}',
  'recent.thumbnailAlt': 'Miniatura de {name}',
  'recent.removeAria': 'Remover {name} dos recentes',
  'recent.removeTitle': 'Remover dos recentes (o arquivo não será apagado)'
} as const satisfies Record<MessageKey, MessageTemplate>

const zhHans = {
  ...menuZhHans,
  ...documentZhHans,
  'home.actions.label': '项目操作',
  'home.actions.new': '新建',
  'home.actions.openProject': '打开项目',
  'home.actions.openImage': '打开图像',
  'home.actions.openPdf': '打开 PDF',
  'home.actions.returnToEditor': '返回编辑器',
  'home.recent.subtitle': '从上次中断的地方继续',
  'home.recent.title': '最近的项目',
  'home.recent.clear': '清除历史记录',
  'home.recent.loading': '正在加载最近的项目',
  'home.recent.emptyTitle': '没有最近的项目',
  'home.recent.emptyDescription': '创建文档、打开 .axia 项目，或将图像或 PDF 拖到此处。',
  'home.recent.count': { one: '{count} 个最近的项目', other: '{count} 个最近的项目' },
  'recent.dateUnavailable': '日期不可用',
  'recent.fileMissing': '找不到文件',
  'recent.open': '打开 {path}',
  'recent.fileMissingAtPath': '找不到文件：{path}',
  'recent.thumbnailAlt': '{name} 的缩略图',
  'recent.removeAria': '从最近的项目中移除 {name}',
  'recent.removeTitle': '从最近的项目中移除（不会删除文件）'
} as const satisfies Record<MessageKey, MessageTemplate>

export const OFFICIAL_CATALOGS: Readonly<Record<OfficialLocale, Readonly<Record<MessageKey, MessageTemplate>>>> = {
  'pt-BR': ptBR,
  'en-US': enUS,
  'zh-Hans': zhHans
}

/** Returns plain text only; callers must render it as text, never as HTML. */
export function formatOfficialMessage(
  locale: OfficialLocale,
  key: MessageKey,
  params: MessageParams = {}
): string {
  const template = OFFICIAL_CATALOGS[locale]?.[key] ?? enUS[key]
  let message: string
  if (typeof template === 'string') {
    message = template
  } else {
    const count = params.count
    if (typeof count !== 'number' || !Number.isFinite(count)) {
      throw new Error(`Parâmetro numérico count ausente para ${key}.`)
    }
    message = new Intl.PluralRules(locale).select(count) === 'one' ? template.one : template.other
  }
  return message.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) {
      throw new Error(`Parâmetro ${name} ausente para ${key}.`)
    }
    const value = params[name]
    return typeof value === 'number' ? new Intl.NumberFormat(locale).format(value) : value
  })
}
