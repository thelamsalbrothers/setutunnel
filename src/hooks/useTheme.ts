import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

function readTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

/**
 * Reads/sets the `.dark` class on <html> (initialized pre-paint in index.html).
 * The theme follows the OS by default; toggling saves an explicit choice that
 * wins over the system setting. While no explicit choice is saved, live OS
 * theme changes are mirrored.
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(readTheme)

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark'
      document.documentElement.classList.toggle('dark', next === 'dark')
      try {
        localStorage.setItem('setu-theme', next)
      } catch {
        // ignore (private mode)
      }
      return next
    })
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => {
      // Only mirror the OS while the user hasn't picked a theme explicitly.
      let saved: string | null = null
      try {
        saved = localStorage.getItem('setu-theme')
      } catch {
        saved = null
      }
      if (saved) return
      document.documentElement.classList.toggle('dark', media.matches)
      setTheme(media.matches ? 'dark' : 'light')
    }
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  return { theme, toggle }
}
