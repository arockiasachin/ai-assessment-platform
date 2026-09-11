# Archived: duplicate quiz-generation implementation

**Status:** deprecated, never merged. Preserved in full for reference.

## What it is

A second, independent implementation of LLM quiz generation, built in parallel with the
implementation that shipped. Both were produced by separate agents working from the same brief
during the Phase 2 pod fan-out; neither knew about the other.

| | Shipped | Archived |
| --- | --- | --- |
| Library | `lib/quiz-generation/**` (12 files) | `lib/quiz-generation/**` (11 files, overlapping) |
| Teacher API | `app/api/teacher/quiz-generation/**` | `app/api/teacher/quiz/**` |
| UI | `components/teacher-quiz-generator.tsx` | `components/teacher-quiz-generator.tsx` (conflicting) |
| Merged in | `25e47ed` | never merged |

## Why it was not merged

Merging would have created **conflicting duplicate routes for the same capability** — two
teacher-facing quiz-generation APIs (`/api/teacher/quiz-generation/*` and `/api/teacher/quiz/*`),
two overlapping library modules with the same filenames, and two versions of the same component.
There is no product reason to ship both, and a half-merged combination would be worse than either.

## Where it lives

- **Commit:** `67809f7f93ad48d72d0b738aa3b7bf6ad88bcc4b`
- **Annotated tag:** `archive/quiz-generation-duplicate` (pushed to `origin`, so it survives loss of
  any local clone)
- **Size:** 29 files, +3,006 lines against `dev`
- **Tests at the time:** 22 files / 127 passing

To inspect it:

```bash
git show archive/quiz-generation-duplicate --stat
git diff dev...archive/quiz-generation-duplicate
```

To resurrect it deliberately (not recommended without a specific reason):

```bash
git checkout -b resurrect/quiz-generation-dup archive/quiz-generation-duplicate
```

## Anything worth harvesting?

Reviewed at archive time. It is a genuine alternative take rather than a superset — it does not
contain features the shipped version lacks. Its distinguishing choices were:

- a different route layout under `/api/teacher/quiz/*` rather than `/api/teacher/quiz-generation/*`;
- its own draft/published state handling in `Question.metadata` (the shipped version does the same,
  so no gain);
- a slightly different test breakdown (`state` and `pipeline` tests).

Nothing was judged worth porting. If the shipped implementation is ever revisited, this branch is a
useful second opinion on the same problem, which is why it was archived rather than deleted.

## Lesson recorded

This duplicate exists because parallel agents were given overlapping scope with no shared interface
frozen first, and because one pod's execution was misread as failed and re-issued elsewhere. The
recovery — a safety gate that verified every branch was merged before cleanup — is what caught it.
See `docs/development-workflow.md`.
