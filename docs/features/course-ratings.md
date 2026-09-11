# Feature: course ratings

Students rate the courses they completed; teachers get a per-course ratings
report with an average, a count, and the comments behind them. The feature was
live before `258108a` (`feat(schema): unfreeze schema...`) dropped the
`CourseRating` model and its consumer code on an audit that wrongly reported
zero references. It is restored in `20260912010000_restore_course_rating` with
its original, already-modernized implementation (`requireRole`, `parseJsonBody`,
zod contracts).

## What it does

- A signed-in **student** who has an **active enrollment** in an offering that
  has **already ended** can submit one rating (1–5) with an optional comment
  (≤ 500 characters). Re-rating updates the existing row rather than creating a
  duplicate, because `CourseRating` has `@@unique([offeringId, studentId])`.
- A signed-in **teacher** sees every offering they own, including offerings with
  no ratings yet, with each offering's average rating, rating count, and the
  individual ratings (student name, register number, score, comment, timestamp).
- The student courses view shows the course's average rating, the student's own
  rating, and — once the course is completed — a rating control that posts to the
  API. The teacher menu links to a Reports page that renders the aggregates.

## API surface

| Method + path                      | Auth      | Body / query                            | Response                                                                                                                                                 |
| ---------------------------------- | --------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/student/courses/rating` | `student` | `{ offeringId, rating: 1-5, comment? }` | `{ success: true, message }`; `400` invalid body, `403` not enrolled, `409` not completed, `404` no profile                                              |
| `GET /api/teacher/reports/ratings` | `teacher` | —                                       | `{ offerings: [{ offeringId, courseCode, courseName, className, term, academicYear, ratingsCount, averageRating, ratings[] }] }`; `404` no staff profile |

The request body is validated by `courseRatingRequestSchema`
(`lib/contracts/gradebook.ts`); `rating` is coerced to an integer in `[1, 5]`
and `comment` is trimmed and capped at 500 characters. The report row and
response shapes are described by `courseOfferingRatingsReportSchema` /
`courseRatingsReportResponseSchema` in the same file, so the route, the client,
and the tests share one definition.

Data access lives in `lib/course-ratings.ts` (`submitCourseRating`,
`getTeacherRatingsReport`); the handlers only map outcomes to status codes and
reduce unexpected database errors to a generic `500` that does not echo
internals.

## Authorization rules

- **Signed-in role.** Both routes call `requireRole`; an anonymous caller gets
  `401`, the wrong role gets `403`, and the database is never reached
  (`tests/course-ratings-route-auth.test.ts`).
- **Enrollment.** `submitCourseRating` resolves the student's profile from the
  signed session (never a client-supplied id) and requires an `Enrollment` for
  that offering with `status: "active"`. A foreign or missing offering and a
  not-enrolled course both return `403`, so the endpoint never confirms that
  someone else's offering exists.
- **Completion.** A rating is only accepted once `CourseOffering.endsOn` is in
  the past; otherwise the handler returns `409`. This is the original rule and
  matches the student UI, which only shows the form for completed courses.
- **Ownership.** `getTeacherRatingsReport` resolves the teacher's `StaffProfile`
  from the signed session and filters offerings by `teacherId: staff.id`. A
  teacher can never read another teacher's offerings; a session without a staff
  profile is `404`. This is object-level ownership, consistent with
  `lib/analytics/authz.ts` and `lib/gradebook-db.ts`.

## Schema and migration

- `CourseRating` (`prisma/schema.prisma`): `id`, `offeringId`, `studentId`,
  `rating`, `comment?`, `createdAt`, `updatedAt`, cascading relations to
  `CourseOffering` and `StudentProfile`, `@@unique([offeringId, studentId])`,
  and indexes on `offeringId` and `studentId`. The back-relation arrays
  `CourseOffering.ratings` and `StudentProfile.courseRatings` are restored too.
- `prisma/migrations/20260912010000_restore_course_rating/migration.sql`
  re-creates the table, indexes, and foreign keys. It was produced with
  `prisma migrate diff` against the schema at `258108a`, so the migration history
  still reproduces `prisma/schema.prisma` from empty. The existing baseline and
  `schema_unfreeze` migrations are untouched.

## Tests

| File                                      | Coverage                                                                                                                                                                                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/course-ratings.test.ts`            | DB-backed through real route handlers and signed sessions: enrolled student rates a completed course and re-rating upserts; not-enrolled → `403`; not-completed and waitlisted → rejected; teacher report is scoped to owned offerings and computes real aggregates. |
| `tests/course-ratings-route-auth.test.ts` | Route-level: anonymous → `401`, wrong role → `403`, out-of-range/mistyped rating → `400`, all before the service runs; authorized requests pass through.                                                                                                             |

## Deliberately out of scope

- **Waitlisted students cannot rate.** The original code accepted any enrollment
  row; this restoration requires `status: "active"`, which excludes the waitlist.
- **No teacher reply or moderation.** Ratings are append/update only; there is no
  hiding, flagging, or teacher response.
- **No per-offering anonymity toggle.** A teacher sees the rating alongside the
  student's name and register number, as in the original feature.
- **No pagination.** The report returns every owned offering and every rating;
  the datasets are class-sized.
- **The completion rule is fixed.** There is no way to rate an in-progress
  offering, and no scheduled job that opens ratings at `endsOn`.
