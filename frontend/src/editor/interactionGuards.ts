export function editorIsBlockedByModal(newDocumentOpen: boolean, unsavedChangesOpen: boolean) {
  return newDocumentOpen || unsavedChangesOpen
}

export function canCreateDocument(busy: boolean, validationError = '') {
  return !busy && !validationError
}
