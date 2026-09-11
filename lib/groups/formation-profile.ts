import type { Prisma } from "@/lib/generated/prisma/client"
import { formationProfileSchema, type FormationProfileValue } from "@/lib/contracts/groups"

/**
 * Reader/writer for `StudentProfile.formationProfile`, the persisted per-student
 * team-formation attributes and availability.
 *
 * The column is instructor-controlled JSON, so reads are defensive: a malformed
 * stored value is treated as "not configured" (`{}` / no availability) rather
 * than failing a formation run. `attributes` is always present; `availability`
 * is absent when the student has not declared any slots (unconstrained).
 */
export function readFormationProfile(value: unknown): FormationProfileValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { attributes: {} }
  }
  const parsed = formationProfileSchema.safeParse(value)
  return parsed.success ? parsed.data : { attributes: {} }
}

export function toFormationProfileJson(profile: FormationProfileValue): Prisma.InputJsonValue {
  return {
    attributes: profile.attributes,
    ...(profile.availability !== undefined ? { availability: profile.availability } : {}),
  } as unknown as Prisma.InputJsonValue
}

/**
 * The formation-facing projection of a stored profile: `availability` is only
 * included when declared, matching `FormationStudent.availability` semantics
 * (absent = unconstrained, `[]` = never available).
 */
export function toFormationStudent(profile: FormationProfileValue): {
  attributes: FormationProfileValue["attributes"]
  availability?: string[]
} {
  return {
    attributes: profile.attributes,
    ...(profile.availability !== undefined ? { availability: profile.availability } : {}),
  }
}
