import type { ReactElement } from 'react'
import type { NotificationAction, OverlayNotificationPayload } from '../../shared/notification'

const DEFAULT_ACTIONS: NotificationAction[] = [
  { id: 'guide', label: 'Guide me', kind: 'guide' },
  { id: 'dismiss', label: 'dismiss', kind: 'dismiss' }
]

function firstLine(message: string): string {
  const line = message.split(/\r?\n/)[0]
  return line ?? ''
}

type Props = {
  item: OverlayNotificationPayload
  isNewest: boolean
  guideMode: boolean
  onDismiss: () => void
  onGuide: () => void
}

export function NotificationCard({
  item,
  isNewest,
  guideMode,
  onDismiss,
  onGuide
}: Props): ReactElement {
  const actions = item.actions?.length ? item.actions : DEFAULT_ACTIONS
  const bodyText = isNewest ? item.message : firstLine(item.message)
  const collapsedOlder = !isNewest

  return (
    <div
      className={`notification-card overlay-hit${guideMode ? ' notification-card--guide' : ''}${
        !isNewest ? ' notification-card--older' : ''
      }`}
    >
      {!collapsedOlder && item.contextSource ? (
        <div className="notification-card__context">{item.contextSource}</div>
      ) : null}
      {!collapsedOlder && item.codeSnippet ? (
        <pre className="notification-card__code">{item.codeSnippet}</pre>
      ) : null}
      <div className="notification-card__body">{bodyText}</div>
      {isNewest ? (
        <div className="notification-card__actions">
          {actions.map((a) => {
            if (a.kind === 'dismiss' || a.label.toLowerCase() === 'dismiss') {
              return (
                <button
                  key={a.id}
                  type="button"
                  className="link-dismiss"
                  onClick={onDismiss}
                >
                  {a.label}
                </button>
              )
            }
            const isGuideAction =
              a.kind === 'guide' || a.id === 'guide'
            const guideLabel =
              isGuideAction && guideMode ? 'Stop guiding' : a.label
            return (
              <button
                key={a.id}
                type="button"
                className="btn-guide"
                aria-pressed={isGuideAction ? guideMode : undefined}
                onClick={onGuide}
              >
                {guideLabel}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
