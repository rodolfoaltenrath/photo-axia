import type { EditorTool } from '../types/editor.ts'

export const INTELLIGENT_SELECTION_TOOLS = [
  'object-selection',
  'quick-selection',
  'magic-wand'
] as const satisfies readonly EditorTool[]

export const ENABLED_INTELLIGENT_SELECTION_TOOLS = ['quick-selection', 'magic-wand'] as const

export type IntelligentSelectionTool = (typeof INTELLIGENT_SELECTION_TOOLS)[number]

export function isIntelligentSelectionTool(tool: string): tool is IntelligentSelectionTool {
  return (INTELLIGENT_SELECTION_TOOLS as readonly string[]).includes(tool)
}

export function isIntelligentSelectionToolEnabled(tool: IntelligentSelectionTool): boolean {
  return (ENABLED_INTELLIGENT_SELECTION_TOOLS as readonly IntelligentSelectionTool[]).includes(tool)
}

export function nextIntelligentSelectionTool(
  current: IntelligentSelectionTool,
  enabled: readonly IntelligentSelectionTool[] = ENABLED_INTELLIGENT_SELECTION_TOOLS
): IntelligentSelectionTool {
  if (!enabled.length) return 'magic-wand'
  const currentIndex = enabled.indexOf(current)
  return enabled[(currentIndex + 1 + enabled.length) % enabled.length]!
}

export function availableIntelligentSelectionTool(
  preferred: IntelligentSelectionTool
): IntelligentSelectionTool {
  return isIntelligentSelectionToolEnabled(preferred)
    ? preferred
    : ENABLED_INTELLIGENT_SELECTION_TOOLS[0]
}

/** Atalhos diretos evitam alternâncias invisíveis entre as ferramentas do grupo W. */
export function intelligentSelectionToolForShortcut(shiftKey: boolean): IntelligentSelectionTool {
  return availableIntelligentSelectionTool(shiftKey ? 'quick-selection' : 'magic-wand')
}
