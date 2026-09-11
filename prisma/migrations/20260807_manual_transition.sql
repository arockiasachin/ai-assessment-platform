ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;

UPDATE "User"
SET "passwordHash" = COALESCE("passwordHash", "password")
WHERE "passwordHash" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UserRole') THEN
    CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'TEACHER', 'STUDENT');
  END IF;
END $$;

ALTER TABLE "User"
  ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "User"
  ALTER COLUMN "role" TYPE "UserRole"
  USING (
    CASE
      WHEN UPPER("role"::text) = 'ADMIN' THEN 'ADMIN'::"UserRole"
      WHEN UPPER("role"::text) = 'TEACHER' THEN 'TEACHER'::"UserRole"
      ELSE 'STUDENT'::"UserRole"
    END
  );

ALTER TABLE "User"
  ALTER COLUMN "passwordHash" SET NOT NULL;

ALTER TABLE "User"
  ALTER COLUMN "role" SET DEFAULT 'STUDENT';
