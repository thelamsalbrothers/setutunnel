import type { ReactNode } from 'react'

interface IconProps {
  className?: string
}

function Svg({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const SunIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
)

export const MoonIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </Svg>
)

export const UploadIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M12 15V3m0 0 4 4m-4-4-4 4" />
    <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
  </Svg>
)

export const DownloadIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </Svg>
)

export const CopyIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Svg>
)

export const CheckIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
)

export const ShieldIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
)

export const BoltIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
  </Svg>
)

export const GhostIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M9 10h.01M15 10h.01" />
    <path d="M12 2a8 8 0 0 0-8 8v11l3-2 3 2 2-2 2 2 3-2V10a8 8 0 0 0-8-8Z" />
  </Svg>
)

export const FileIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
    <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
  </Svg>
)

export const AlertIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M12 9v4m0 4h.01" />
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
  </Svg>
)

export const CloseIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
)

export const LinkIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
    <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
  </Svg>
)

export const SpinnerIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M12 3a9 9 0 1 0 9 9" />
  </Svg>
)

export const InstallIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <rect x="7" y="3" width="10" height="18" rx="2" />
    <path d="M12 8v5m0 0 2-2m-2 2-2-2" />
  </Svg>
)

export const HelpIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.3 9.3a2.7 2.7 0 0 1 5.2 1c0 1.8-2.5 2.1-2.5 3.7" />
    <path d="M12 17h.01" />
  </Svg>
)
