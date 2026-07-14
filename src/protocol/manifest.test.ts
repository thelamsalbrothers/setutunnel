import { describe, expect, it } from 'vitest'
import {
  assessFile,
  buildManifest,
  sanitizePath,
  validateManifest,
} from './manifest'
import type { FileEntry, ManifestMessage } from './messages'

describe('sanitizePath (§4.7 traversal / zip-slip)', () => {
  it('strips path traversal', () => {
    expect(sanitizePath('../../etc/passwd')).toBe('etc/passwd')
    expect(sanitizePath('a/../../b')).toBe('b')
    expect(sanitizePath('foo/../../bar')).toBe('bar')
  })

  it('neutralizes absolute and backslash paths', () => {
    const win = sanitizePath('C:\\Windows\\System32\\evil.dll')
    expect(win.startsWith('/')).toBe(false)
    expect(win).not.toContain('..')
    expect(win).not.toContain('\\')
    expect(sanitizePath('/etc/shadow').startsWith('/')).toBe(false)
  })

  it('keeps legitimate spaces and hyphens', () => {
    expect(sanitizePath('My Report - final.pdf')).toBe('My Report - final.pdf')
  })

  it('replaces filesystem-illegal characters', () => {
    expect(sanitizePath('a<b>c:d.txt')).toBe('a_b_c_d.txt')
  })

  it('never returns an empty name', () => {
    expect(sanitizePath('..')).toBe('file')
    expect(sanitizePath('')).toBe('file')
  })

  it('neutralizes Windows reserved device names', () => {
    expect(sanitizePath('CON')).toBe('_CON')
    expect(sanitizePath('nul.txt')).toBe('_nul.txt')
  })
})

describe('assessFile (§4.7 risky types)', () => {
  it('flags executables and scripts', () => {
    expect(assessFile({ path: 'setup.exe', size: 1, type: '' }).dangerous).toBe(
      true,
    )
    expect(assessFile({ path: 'run.js', size: 1, type: '' }).dangerous).toBe(
      true,
    )
  })

  it('flags a double-extension disguise (invoice.pdf.exe)', () => {
    const v = assessFile({
      path: 'invoice.pdf.exe',
      size: 1,
      type: 'application/pdf',
    })
    expect(v.dangerous).toBe(true)
    expect(v.reasons.join(' ')).toContain('double extension')
    expect(v.reasons.join(' ')).toContain('does not match')
  })

  it('flags an executable MIME type', () => {
    expect(
      assessFile({ path: 'file', size: 1, type: 'application/x-msdownload' })
        .dangerous,
    ).toBe(true)
  })

  it('accepts ordinary documents and images', () => {
    expect(
      assessFile({ path: 'photo.png', size: 1, type: 'image/png' }).dangerous,
    ).toBe(false)
    expect(
      assessFile({ path: 'report.pdf', size: 1, type: 'application/pdf' })
        .dangerous,
    ).toBe(false)
  })
})

describe('validateManifest / buildManifest', () => {
  const file = (over: Partial<FileEntry> = {}): FileEntry => ({
    path: 'a.txt',
    size: 10,
    type: 'text/plain',
    ...over,
  })

  it('builds a valid manifest and sanitizes paths', () => {
    const m = buildManifest('t1', [file({ path: '../a.txt' })])
    expect(m.files[0].path).toBe('a.txt')
    expect(m.totalBytes).toBe(10)
  })

  it('rejects an empty manifest (fail closed)', () => {
    expect(() =>
      validateManifest({
        type: 'manifest',
        transferId: 't',
        files: [],
        totalBytes: 0,
        chunkSize: 65536,
      }),
    ).toThrow()
  })

  it('rejects a totalBytes mismatch', () => {
    const m: ManifestMessage = {
      type: 'manifest',
      transferId: 't',
      files: [file({ size: 10 })],
      totalBytes: 999,
      chunkSize: 65536,
    }
    expect(() => validateManifest(m)).toThrow(/totalBytes/)
  })

  it('rejects an out-of-range chunkSize', () => {
    const m: ManifestMessage = {
      type: 'manifest',
      transferId: 't',
      files: [file()],
      totalBytes: 10,
      chunkSize: 1,
    }
    expect(() => validateManifest(m)).toThrow(/chunkSize/)
  })

  it('disambiguates paths that collide after sanitizing', () => {
    const m = buildManifest('t', [
      file({ path: 'x.txt', size: 1 }),
      file({ path: 'sub/../x.txt', size: 1 }), // resolves to x.txt → collision
    ])
    const paths = m.files.map((f) => f.path)
    expect(paths[0]).toBe('x.txt')
    expect(paths[1]).not.toBe('x.txt')
    expect(new Set(paths).size).toBe(2)
  })
})
