/**
 * Pure split math for the editor workspace.
 *
 * Kept out of the component so the divider's behaviour — the pointer mapping,
 * the bounds, and which keys resize — is unit-testable without a DOM (the repo
 * convention: testable display logic lives in `lib/`). The component owns only
 * the React state and the pointer capture.
 */

export type SplitBounds = {
  /** Smallest allowed left-pane width, in percent. */
  min: number
  /** Largest allowed left-pane width, in percent. */
  max: number
}

/** Clamp a percentage into the pane's bounds; `NaN` falls back to `min`. */
export function clampSplit(value: number, { min, max }: SplitBounds): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

/**
 * The split a resize key produces, or `null` when the key is not a resize key
 * (so the caller can leave it to the browser).
 *
 * `ArrowLeft`/`ArrowRight` step by `step`; `Home`/`End` jump to the bounds.
 */
export function splitForKey(
  current: number,
  key: string,
  bounds: SplitBounds,
  step: number,
): number | null {
  switch (key) {
    case "ArrowLeft":
      return clampSplit(current - step, bounds)
    case "ArrowRight":
      return clampSplit(current + step, bounds)
    case "Home":
      return bounds.min
    case "End":
      return bounds.max
    default:
      return null
  }
}

/**
 * The split that puts the divider under `clientX`, as a percentage of the
 * container, clamped to the bounds. Returns `null` for a degenerate container
 * (a zero/NaN width) so the caller can ignore the move instead of dividing by
 * zero.
 */
export function splitFromPointer(
  clientX: number,
  containerLeft: number,
  containerWidth: number,
  bounds: SplitBounds,
): number | null {
  if (
    !Number.isFinite(clientX) ||
    !Number.isFinite(containerLeft) ||
    !Number.isFinite(containerWidth) ||
    containerWidth <= 0
  ) {
    return null
  }
  const percent = ((clientX - containerLeft) / containerWidth) * 100
  return clampSplit(percent, bounds)
}
