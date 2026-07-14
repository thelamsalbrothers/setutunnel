import {
  DEFAULT_CHUNK_SIZE,
  MAX_CHUNK_SIZE,
  MAX_FILENAME_LENGTH,
  MAX_FILES,
  MAX_TOTAL_BYTES,
  MIN_CHUNK_SIZE,
} from './constants'
import type { FileEntry, ManifestMessage } from './messages'

/**
 * Manifest building/validation and the content-safety trust boundary (§4.7).
 * Every incoming byte is treated as hostile: paths are sanitized against
 * traversal / zip-slip, risky types are flagged for a second confirmation, and
 * a malformed manifest fails closed (throws) rather than being partially trusted.
 */

// Executable / script extensions that require a second, deliberate confirm.
const DANGEROUS_EXTENSIONS: ReadonlySet<string> = new Set([
  'exe',
  'scr',
  'bat',
  'cmd',
  'com',
  'pif',
  'msi',
  'msix',
  'vbs',
  'vbe',
  'js',
  'jse',
  'ws',
  'wsf',
  'wsh',
  'ps1',
  'psm1',
  'sh',
  'bash',
  'zsh',
  'jar',
  'app',
  'dmg',
  'pkg',
  'deb',
  'rpm',
  'apk',
  'dll',
  'sys',
  'cpl',
  'hta',
  'reg',
  'lnk',
  'gadget',
  'scf',
  'inf',
  'ade',
  'adp',
  'chm',
  'ins',
])

// Common benign extensions used to spot a disguising double extension.
const BENIGN_EXTENSIONS: ReadonlySet<string> = new Set([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'txt',
  'rtf',
  'csv',
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'heic',
  'mp4',
  'mov',
  'mp3',
  'zip',
])

const EXECUTABLE_MIME: ReadonlySet<string> = new Set([
  'application/x-msdownload',
  'application/x-executable',
  'application/x-dosexec',
  'application/vnd.microsoft.portable-executable',
  'application/x-sh',
])

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])([.]|$)/i
// Filesystem-illegal characters. Spaces and hyphens are intentionally kept —
// they are legitimate in filenames. Control chars are stripped separately.
const VISIBLE_ILLEGAL = '<>:"|?*'
const BACKSLASH = String.fromCharCode(92)

export interface SafetyVerdict {
  /** True ⇒ show the red warning and require a second confirmation (§4.7). */
  dangerous: boolean
  reasons: string[]
}

function isControlCode(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f)
}

function truncateName(name: string, max: number): string {
  if (name.length <= max) return name
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return name.slice(0, max)
  const ext = name.slice(dot)
  if (ext.length >= max) return name.slice(0, max)
  return name.slice(0, max - ext.length) + ext
}

/**
 * Sanitize an untrusted filename or relative path (§4.7): normalize separators,
 * drop `.`/`..` and empty segments (defeats `../` traversal and folder-mode
 * zip-slip), strip control and filesystem-illegal characters, neutralize
 * Windows reserved names, and cap length. Never returns an absolute path.
 */
export function sanitizePath(rawPath: string): string {
  const normalized = rawPath.split(BACKSLASH).join('/')
  const safe: string[] = []
  for (const seg of normalized.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      safe.pop() // resolve up a level, but can never escape the root
      continue
    }
    let cleaned = ''
    for (const ch of seg) {
      const code = ch.codePointAt(0) ?? 0
      if (isControlCode(code)) continue
      cleaned += VISIBLE_ILLEGAL.includes(ch) ? '_' : ch
    }
    cleaned = cleaned.replace(/[. ]+$/, '') // Windows: no trailing dot/space
    if (cleaned === '') continue
    if (WINDOWS_RESERVED.test(cleaned)) cleaned = `_${cleaned}`
    safe.push(truncateName(cleaned, MAX_FILENAME_LENGTH))
  }
  return safe.join('/') || 'file'
}

function extensionsOf(path: string): string[] {
  const base = path.split('/').pop() ?? path
  const parts = base.split('.')
  return parts.length <= 1 ? [] : parts.slice(1).map((p) => p.toLowerCase())
}

/**
 * Flag risky files (§4.7): dangerous extensions, double-extension disguises
 * (`invoice.pdf.exe`), and MIME-vs-extension mismatches. Ordinary docs/images
 * come back `dangerous: false`.
 */
export function assessFile(entry: FileEntry): SafetyVerdict {
  const reasons: string[] = []
  const exts = extensionsOf(entry.path)
  const last = exts.at(-1)
  const prev = exts.at(-2)
  const mime = entry.type.toLowerCase()

  if (last && DANGEROUS_EXTENSIONS.has(last)) {
    reasons.push(`executable/script type ".${last}"`)
    if (prev && BENIGN_EXTENSIONS.has(prev)) {
      reasons.push(`double extension disguising ".${prev}" as ".${last}"`)
    }
    if (
      mime.startsWith('image/') ||
      mime.startsWith('text/') ||
      mime === 'application/pdf'
    ) {
      reasons.push('declared MIME type does not match the executable extension')
    }
  }

  if (EXECUTABLE_MIME.has(mime)) {
    reasons.push('declared executable MIME type')
  }

  return { dangerous: reasons.length > 0, reasons }
}

function disambiguate(path: string, taken: ReadonlySet<string>): string {
  const dot = path.lastIndexOf('.')
  const stem = dot > 0 ? path.slice(0, dot) : path
  const ext = dot > 0 ? path.slice(dot) : ''
  for (let i = 1; ; i++) {
    const candidate = `${stem} (${i})${ext}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * Validate an incoming manifest and return a normalized copy with sanitized,
 * collision-free paths. Throws on any cap violation or inconsistency — the
 * transfer must fail closed rather than proceed on a malformed manifest (§4.7).
 */
export function validateManifest(msg: ManifestMessage): ManifestMessage {
  if (!Array.isArray(msg.files) || msg.files.length === 0) {
    throw new Error('manifest: must contain at least one file')
  }
  if (msg.files.length > MAX_FILES) {
    throw new Error(`manifest: too many files (> ${MAX_FILES})`)
  }
  if (
    !Number.isInteger(msg.chunkSize) ||
    msg.chunkSize < MIN_CHUNK_SIZE ||
    msg.chunkSize > MAX_CHUNK_SIZE
  ) {
    throw new Error('manifest: chunkSize out of range')
  }

  let total = 0
  const seen = new Set<string>()
  const files: FileEntry[] = []
  for (const f of msg.files) {
    if (!Number.isInteger(f.size) || f.size < 0) {
      throw new Error('manifest: invalid file size')
    }
    total += f.size
    let path = sanitizePath(f.path)
    if (seen.has(path)) path = disambiguate(path, seen)
    seen.add(path)
    files.push({
      path,
      size: f.size,
      type: typeof f.type === 'string' ? f.type : '',
    })
  }

  if (total > MAX_TOTAL_BYTES) {
    throw new Error('manifest: total size exceeds cap')
  }
  if (msg.totalBytes !== total) {
    throw new Error('manifest: totalBytes does not match the sum of file sizes')
  }

  return { ...msg, files }
}

/** Build a validated, normalized manifest for the sender side. */
export function buildManifest(
  transferId: string,
  files: FileEntry[],
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): ManifestMessage {
  const totalBytes = files.reduce((n, f) => n + f.size, 0)
  return validateManifest({
    type: 'manifest',
    transferId,
    files,
    totalBytes,
    chunkSize,
  })
}
