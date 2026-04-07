/** Shared SVG micro-icons — replaces emoji throughout the app.
 *  All icons use currentColor so they inherit text color from parent.
 *  Standard size: 14×14 (override via style/className). */

interface IconProps {
  size?: number
  className?: string
}

export function IconDelete({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </svg>
  )
}

export function IconRotate({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M13 8A5 5 0 1 1 8 3h3" />
      <polyline points="11 1 11 5 7 5" transform="translate(0 -1)" />
    </svg>
  )
}

export function IconLocked({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" />
    </svg>
  )
}

export function IconUnlocked({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5 7V5a3 3 0 0 1 6 0" />
    </svg>
  )
}

export function IconDuplicate({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="5" y="5" width="8" height="8" rx="1.5" />
      <path d="M3 11V3.5A.5.5 0 0 1 3.5 3H11" />
    </svg>
  )
}

export function IconSave({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M13 14H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h7l3 3v9a1 1 0 0 1-1 1z" />
      <polyline points="9 2 9 6 5 6" />
      <line x1="5" y1="10" x2="11" y2="10" />
      <line x1="5" y1="12" x2="8" y2="12" />
    </svg>
  )
}

export function IconOpen({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2 13V3a1 1 0 0 1 1-1h4l2 2h4a1 1 0 0 1 1 1v1" />
      <path d="M2 13l1.5-6h11L13 13H2z" />
    </svg>
  )
}

export function IconPrint({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="4 6 4 1 12 1 12 6" />
      <rect x="2" y="6" width="12" height="6" rx="1" />
      <rect x="4" y="10" width="8" height="4" rx="0.5" />
    </svg>
  )
}

export function IconDownload({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M8 2v8" />
      <polyline points="4 7 8 11 12 7" />
      <line x1="3" y1="14" x2="13" y2="14" />
    </svg>
  )
}

export function IconToggleOn({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className}>
      <circle cx="8" cy="8" r="5" fill="currentColor" />
    </svg>
  )
}

export function IconToggleOff({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.6" className={className}>
      <circle cx="8" cy="8" r="5" />
    </svg>
  )
}

export function IconKeyboard({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="1" y="3" width="14" height="10" rx="1.5" />
      <line x1="4" y1="6" x2="4.01" y2="6" strokeWidth="2" />
      <line x1="8" y1="6" x2="8.01" y2="6" strokeWidth="2" />
      <line x1="12" y1="6" x2="12.01" y2="6" strokeWidth="2" />
      <line x1="5" y1="10" x2="11" y2="10" />
    </svg>
  )
}
