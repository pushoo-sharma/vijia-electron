import { forwardRef, type ReactElement } from 'react'
import ijiFaceUrl from '../../../public/brand/iji-face.png'

type Props = {
  guideMode?: boolean
  onTogglePrompt: () => void
}

export const Circle = forwardRef<HTMLButtonElement, Props>(function Circle(
  { guideMode = false, onTogglePrompt },
  ref
): ReactElement {
  return (
    <button
      ref={ref}
      type="button"
      className={`vijia-circle overlay-hit${guideMode ? ' vijia-circle--guide' : ''}`}
      aria-label="Toggle Vijia prompt"
      onClick={onTogglePrompt}
    >
      <img
        src={ijiFaceUrl}
        alt=""
        className="vijia-circle__face"
        aria-hidden
        width={48}
        height={48}
      />
    </button>
  )
})
