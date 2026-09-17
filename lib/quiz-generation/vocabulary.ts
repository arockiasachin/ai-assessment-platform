/**
 * The course's canonical subtopic vocabulary: reading it, cleaning it, and classifying tags against it.
 *
 * ## The problem this exists to solve
 *
 * `Question.subtopic` is model-generated free text, and when a teacher supplies no tags the prompt
 * says, verbatim, *"choose 2-4 coherent subtopics yourself."* So the vocabulary is invented per
 * request: two generations on one course produce **disjoint** tags, and `slope` / `Slope` /
 * `gradient & intercept` become three unrelated topics with nothing recording that they mean one
 * thing.
 *
 * `lib/analytics/subtopics.ts` refuses to merge them, and that refusal is right — merging by string
 * similarity would invent a taxonomy the data cannot support. The remedy is therefore a **declared**
 * vocabulary: a list a teacher owns, which generation is constrained to, so the tags stop being
 * invented at all.
 *
 * ## The one normalisation this does, and the ones it refuses
 *
 * **Case.** Classification folds case, because `Slope` and the declared `slope` are the same tag
 * written differently — case is formatting, not semantics, and no teacher would consider those two
 * topics. The original casing is always preserved in whatever is displayed.
 *
 * **Refused:** stemming, punctuation folding, synonym matching, fuzzy matching, and whitespace
 * collapsing *within* a tag. Each of those decides meaning, and deciding meaning from string shape is
 * exactly the invented taxonomy the analytics module refuses. `gradient & intercept` and `gradient`
 * stay distinct even though a human might call them one topic — that is a call for the teacher, who
 * can edit the vocabulary.
 */

/** The stored column, read safely. Anything unusable yields an empty list rather than throwing. */
export function parseSubtopicVocabulary(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return cleanVocabulary(value.filter((entry): entry is string => typeof entry === "string"))
}

/**
 * Trim, drop blanks, and remove exact duplicates — preserving order.
 *
 * Called before storage and after reading, so a hand-edited or older value cannot put a blank tag in a
 * dropdown. Case is **not** folded here: two tags differing only in case are left as the teacher wrote
 * them, since this is the list they own. Classification folds case; storage does not.
 */
export function cleanVocabulary(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  const cleaned: string[] = []
  for (const tag of tags) {
    const trimmed = tag.trim()
    if (trimmed === "" || seen.has(trimmed)) continue
    seen.add(trimmed)
    cleaned.push(trimmed)
  }
  return cleaned
}

/** The vocabulary's lookup key. See the module docblock for why case is the only folding applied. */
function key(tag: string): string {
  return tag.trim().toLowerCase()
}

/** Whether a tag is in the vocabulary. Case-insensitive; see the module docblock. */
export function isInVocabulary(tag: string, vocabulary: readonly string[]): boolean {
  const wanted = key(tag)
  return vocabulary.some((entry) => key(entry) === wanted)
}

export type VocabularyPartition = {
  /** Tags the vocabulary declares. */
  inVocabulary: string[]
  /**
   * Tags it does not — the model inventing again.
   *
   * Reported rather than merged, and reported rather than dropped: a tag outside the vocabulary is a
   * fact about how the question was generated, and hiding it would make the vocabulary look more
   * authoritative than it is.
   */
  offVocabulary: string[]
}

/**
 * Split tags into declared and undeclared.
 *
 * With an **empty** vocabulary everything is reported as off-vocabulary, including when the column is
 * null. That is deliberate: an undeclared course has no controlled list, so claiming its tags are
 * "in vocabulary" would invent the very thing this module exists to make explicit.
 */
export function partitionByVocabulary(
  tags: readonly string[],
  vocabulary: readonly string[],
): VocabularyPartition {
  const inVocabulary: string[] = []
  const offVocabulary: string[] = []
  for (const tag of tags) {
    if (vocabulary.length > 0 && isInVocabulary(tag, vocabulary)) inVocabulary.push(tag)
    else offVocabulary.push(tag)
  }
  return { inVocabulary, offVocabulary }
}

/**
 * The tags to constrain generation to, given what the request asked for and what the course stores.
 *
 * **A request that names tags declares them.** That is how a teacher sets the vocabulary: the
 * generation form already takes subtopics, so supplying them defines the course's list rather than
 * being a one-off hint that the next request cannot see. Without this, the vocabulary could only ever
 * be set by a separate editor, and the tags a teacher had already typed would be discarded.
 *
 * An empty request falls back to the stored list, and an undeclared course stays undeclared — an
 * empty list, meaning generation is unconstrained exactly as it was before this existed.
 */
export function resolveVocabulary(input: {
  requested: readonly string[]
  stored: readonly string[]
}): { vocabulary: string[]; declared: boolean } {
  const requested = cleanVocabulary(input.requested)
  if (requested.length > 0) return { vocabulary: requested, declared: true }
  const stored = cleanVocabulary(input.stored)
  return { vocabulary: stored, declared: stored.length > 0 }
}
