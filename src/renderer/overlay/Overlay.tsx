import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { OverlayNotificationPayload } from '../../shared/notification'
import { Circle } from './Circle'
import { NotificationStack } from './NotificationStack'
import { PromptBox } from './PromptBox'
import { useOverlayInteractions } from './useOverlayInteractions'

const MAX_HISTORY_NOTIFICATIONS = 50

export function Overlay(): ReactElement {
  const [items, setItems] = useState<OverlayNotificationPayload[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [guideMode, setGuideMode] = useState(false)
  const [stackFaded, setStackFaded] = useState(false)

  const columnRef = useRef<HTMLDivElement>(null)
  const hubRef = useRef<HTMLDivElement>(null)
  const promptRef = useRef<HTMLDivElement>(null)
  const circleRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const api = window.vijia
    if (!api?.onNotification || !api.onGuideMode) {
      console.warn('[Vijia] overlay preload missing')
      return
    }
    const offNotify = api.onNotification((payload) => {
      setItems((prev) => [...prev, payload].slice(-MAX_HISTORY_NOTIFICATIONS))
      setStackFaded(false)
    })
    const offGuide = api.onGuideMode(({ active }) => {
      setGuideMode(active)
      if (active) {
        setStackFaded(false)
      }
    })
    return () => {
      offNotify()
      offGuide()
    }
  }, [])

  const onDismiss = useCallback((id: string) => {
    window.vijia?.dismiss?.(id)
    setItems((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const onGuide = useCallback(() => {
    window.vijia?.setGuideMode?.(!guideMode)
  }, [guideMode])

  useEffect(() => {
    window.vijia?.setOverlayOpen?.(isOpen)
  }, [isOpen])

  useEffect(() => {
    window.vijia?.setFadeState?.(stackFaded)
  }, [stackFaded])

  useEffect(() => {
    if (!isOpen) return
    const hub = hubRef.current
    if (!hub) return
    queueMicrotask(() => {
      hub.scrollTop = hub.scrollHeight
    })
  }, [isOpen])

  const getInteractiveElements = useCallback((): (HTMLElement | null)[] => {
    const interactive: (HTMLElement | null)[] = [circleRef.current]
    if (isOpen) {
      interactive.push(promptRef.current)
      if (!stackFaded && hubRef.current) {
        const cards = Array.from(
          hubRef.current.querySelectorAll<HTMLElement>('.notification-card')
        )
        interactive.push(...cards)
      }
    }
    return interactive
  }, [isOpen, stackFaded, items])

  useOverlayInteractions({
    getInteractiveElements,
    guideMode,
    onStackFadeChange: setStackFaded,
    hubInteractive: isOpen && !stackFaded && items.length > 0
  })

  const toggleOverlay = useCallback(() => {
    setIsOpen((open) => {
      const next = !open
      if (next) {
        setStackFaded(false)
      }
      return next
    })
  }, [])

  const closeOverlay = useCallback(() => {
    setIsOpen(false)
  }, [])

  return (
    <div className="overlay-root">
      <div ref={columnRef} className="overlay-column">
        {isOpen ? (
          <NotificationStack
            hubRef={hubRef}
            items={items}
            guideMode={guideMode}
            stackFaded={stackFaded}
            onDismiss={onDismiss}
            onGuide={onGuide}
          />
        ) : null}
        <PromptBox open={isOpen} onClose={closeOverlay} rootRef={promptRef} />
        <Circle ref={circleRef} onTogglePrompt={toggleOverlay} />
      </div>
    </div>
  )
}
