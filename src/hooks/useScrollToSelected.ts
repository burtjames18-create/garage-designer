import { useEffect, useRef } from 'react'

/** Scrolls an element into view when `selected` becomes true. */
export function useScrollToSelected<T extends HTMLElement>(selected: boolean) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (selected && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [selected])
  return ref
}
