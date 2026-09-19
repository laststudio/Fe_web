import type { CSSProperties } from 'react'

export function Icon({
  name,
  className = '',
  filled = false,
  style,
}: {
  name: string
  className?: string
  filled?: boolean
  style?: CSSProperties
}) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={{ ...(filled ? { fontVariationSettings: "'FILL' 1" } : {}), ...style }}
      aria-hidden="true"
    >
      {name}
    </span>
  )
}

export default Icon
