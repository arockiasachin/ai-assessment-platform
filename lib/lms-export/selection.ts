/**
 * Selection logic for the teacher export workspace (TN-32).
 *
 * The defect was a piece of derived state that was never recomputed: the weight
 * configuration came from the **initial** offering's export and survived a change of the
 * offering selector. The config's `assessmentIds` therefore belonged to the first
 * offering, `POST /api/teacher/export` validated them against the selected one, and — as
 * designed — answered `400 "… does not belong to this offering"`. Every offering but the
 * first was unexportable.
 *
 * The rule the fix encodes is that the loaded payload is *derived* from the selected
 * offering: if the payload was not loaded for the current selection, it is stale and must
 * be reloaded. This lives here rather than inside the component because the repo has no
 * jsdom, and the condition under which state is invalidated is exactly what regressed.
 */
export function exportNeedsReload(loadedOfferingId: string, selectedOfferingId: string): boolean {
  return selectedOfferingId !== "" && selectedOfferingId !== loadedOfferingId
}
