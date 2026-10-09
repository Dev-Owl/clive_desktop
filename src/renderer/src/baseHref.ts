/*
 * Points relative URLs (images) at the active document's folder.
 * See src/shared/fileUrl.ts for how local paths are served.
 */
export function setDocumentBase(href: string | null): void {
  let base = document.querySelector<HTMLBaseElement>('base#doc-base')
  if (!href) {
    base?.remove()
    return
  }
  if (!base) {
    base = document.createElement('base')
    base.id = 'doc-base'
    document.head.prepend(base)
  }
  base.href = href
}
