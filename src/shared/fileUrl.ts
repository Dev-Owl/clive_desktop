/*
 * Local images are served through the `clive-file://` protocol.
 *
 * The renderer sets `<base href="clive-file://local/<document dir>/">` for
 * the active document, so a relative image like `./img/a.png` resolves to
 * `clive-file://local/<document dir>/img/a.png` and an absolute one like
 * `/Users/me/a.png` resolves to `clive-file://local/Users/me/a.png`.
 * The markdown itself is never rewritten. Web URLs are untouched.
 */

export const FILE_SCHEME = 'clive-file'
export const FILE_HOST = 'local'

/** Build a `<base href>` for a document directory (posix or Windows path). */
export function dirToBaseHref(dir: string): string {
  let p = dir.replace(/\\/g, '/')
  if (!p.startsWith('/')) p = '/' + p // Windows: C:/docs -> /C:/docs
  if (!p.endsWith('/')) p += '/'
  const encoded = p
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/%3A/gi, ':'))
    .join('/')
  return `${FILE_SCHEME}://${FILE_HOST}${encoded}`
}
