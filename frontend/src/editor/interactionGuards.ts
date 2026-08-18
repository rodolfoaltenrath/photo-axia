export function editorIsBlockedByModal(...openDialogs: boolean[]) {
  return openDialogs.some(Boolean)
}

export function canCreateDocument(busy: boolean, validationError = '') {
  return !busy && !validationError
}

type InspectorShortcut = Pick<KeyboardEvent, 'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>

export function isInspectorShortcut(event: InspectorShortcut) {
  if (event.key === 'F12') return true

  const code = event.code.toLowerCase()
  const windowsOrLinuxShortcut = event.ctrlKey && event.shiftKey && ['keyc', 'keyi', 'keyj'].includes(code)
  const macShortcut = event.metaKey && event.altKey && ['keyc', 'keyi', 'keyj'].includes(code)
  return windowsOrLinuxShortcut || macShortcut
}

export function installDesktopInteractionGuards() {
  if (typeof window === 'undefined') return () => undefined

  const blockNativeInteraction = (event: Event) => event.preventDefault()
  const blockInspectorShortcut = (event: KeyboardEvent) => {
    if (isInspectorShortcut(event)) event.preventDefault()
  }

  window.addEventListener('contextmenu', blockNativeInteraction, true)
  window.addEventListener('dragstart', blockNativeInteraction, true)
  window.addEventListener('keydown', blockInspectorShortcut, true)

  return () => {
    window.removeEventListener('contextmenu', blockNativeInteraction, true)
    window.removeEventListener('dragstart', blockNativeInteraction, true)
    window.removeEventListener('keydown', blockInspectorShortcut, true)
  }
}
