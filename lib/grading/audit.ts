import type { Prisma } from "@/lib/generated/prisma/client"

export type AuditActor = {
  id?: string | null
  role?: string | null
}

export type AuditEntry = {
  entityType: string
  entityId: string
  action: string
  actor?: AuditActor
  before?: Prisma.InputJsonValue
  after?: Prisma.InputJsonValue
  metadata?: Prisma.InputJsonValue
}

/**
 * Append one row to `AuditLog`. Takes a transaction client so the audit row
 * commits atomically with the state change it records — no transition can be
 * persisted without its audit entry.
 */
export async function writeAuditLog(
  tx: Prisma.TransactionClient,
  entry: AuditEntry,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      actorId: entry.actor?.id ?? null,
      actorRole: entry.actor?.role ?? null,
      before: entry.before,
      after: entry.after,
      metadata: entry.metadata,
    },
  })
}
