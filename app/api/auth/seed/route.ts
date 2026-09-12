import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { seedRequestSchema } from "@/lib/contracts"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

/**
 * Destructive development seed. Locked down on three independent axes:
 *
 * 1. A real, signature-verified admin session (`requireRole`), re-checked
 *    against the database so a demoted or deleted admin cannot use an old
 *    cookie.
 * 2. An explicit `{ "confirm": "RESET-SEED" }` body — the endpoint cannot be
 *    triggered by a stray request, a prefetch, or a replayed form post.
 * 3. A production kill switch: even an admin must set
 *    `ALLOW_DESTRUCTIVE_SEED=true` to reseed in production.
 *
 * Credentials are never echoed back; the response lists only which accounts
 * were touched.
 */
export async function POST(request: Request) {
  const auth = await requireRole("admin")
  if (!auth.authorized) return auth.response

  const admin = await prisma.user.findUnique({
    where: { id: auth.user.id },
    select: { id: true, role: true },
  })
  if (!admin || admin.role !== "ADMIN") {
    return jsonError("Forbidden", 403)
  }

  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DESTRUCTIVE_SEED !== "true") {
    return jsonError("Destructive seeding is disabled in production.", 403)
  }

  const parsed = await parseJsonBody(request, seedRequestSchema)
  if (!parsed.ok) {
    return jsonError(
      'Destructive reseed requires an explicit body: { "confirm": "RESET-SEED" }.',
      400,
    )
  }

  const adminPassword = await bcrypt.hash("admin", 10)
  const teacherPassword = await bcrypt.hash("teacher123", 10)
  const studentPassword = await bcrypt.hash("student123", 10)
  const devPassword = await bcrypt.hash("dev12345", 10)

  const archivedPassword = await bcrypt.hash("archived-account", 10)
  const legacyAccounts = [
    { oldEmail: "dev.teacher@school.edu", archivedEmail: "archived.dev.teacher@school.edu" },
    { oldEmail: "dev.student@school.edu", archivedEmail: "archived.dev.student@school.edu" },
  ] as const

  for (const legacy of legacyAccounts) {
    const existing = await prisma.user.findUnique({
      where: { email: legacy.oldEmail },
      select: { id: true },
    })
    if (!existing) continue

    await prisma.user.update({
      where: { id: existing.id },
      data: {
        email: legacy.archivedEmail,
        passwordHash: archivedPassword,
      },
    })
  }

  await prisma.user.upsert({
    where: { email: "admin" },
    update: {
      passwordHash: adminPassword,
      role: "ADMIN",
      staffProfile: {
        upsert: {
          create: {
            fullName: "System Admin",
            empId: "EMP-ADMIN-001",
          },
          update: {
            fullName: "System Admin",
          },
        },
      },
    },
    create: {
      email: "admin",
      passwordHash: adminPassword,
      role: "ADMIN",
      staffProfile: {
        create: {
          fullName: "System Admin",
          empId: "EMP-ADMIN-001",
        },
      },
    },
  })

  await prisma.user.upsert({
    where: { email: "olivia.hayes@school.edu" },
    update: {
      passwordHash: devPassword,
      role: "ADMIN",
      staffProfile: {
        upsert: {
          create: {
            fullName: "Olivia Hayes",
            empId: "EMP-A-3001",
          },
          update: {
            fullName: "Olivia Hayes",
            empId: "EMP-A-3001",
          },
        },
      },
    },
    create: {
      email: "olivia.hayes@school.edu",
      passwordHash: devPassword,
      role: "ADMIN",
      staffProfile: {
        create: {
          fullName: "Olivia Hayes",
          empId: "EMP-A-3001",
        },
      },
    },
  })

  // Keep core demo credentials stable regardless of seed path used.
  await prisma.user.upsert({
    where: { email: "teacher.math@school.edu" },
    update: {
      passwordHash: teacherPassword,
      role: "TEACHER",
      staffProfile: {
        upsert: {
          create: {
            fullName: "Maya Carter",
            empId: "EMP-T-1001",
          },
          update: {
            fullName: "Maya Carter",
            empId: "EMP-T-1001",
          },
        },
      },
    },
    create: {
      email: "teacher.math@school.edu",
      passwordHash: teacherPassword,
      role: "TEACHER",
      staffProfile: {
        create: {
          fullName: "Maya Carter",
          empId: "EMP-T-1001",
        },
      },
    },
  })

  await prisma.user.upsert({
    where: { email: "ava.t@school.edu" },
    update: {
      passwordHash: studentPassword,
      role: "STUDENT",
      studentProfile: {
        upsert: {
          create: {
            fullName: "Ava Thompson",
            registerNumber: "REG-1001",
          },
          update: {
            fullName: "Ava Thompson",
            registerNumber: "REG-1001",
          },
        },
      },
    },
    create: {
      email: "ava.t@school.edu",
      passwordHash: studentPassword,
      role: "STUDENT",
      studentProfile: {
        create: {
          fullName: "Ava Thompson",
          registerNumber: "REG-1001",
        },
      },
    },
  })

  await prisma.user.upsert({
    where: { email: "nolan.rivera@school.edu" },
    update: {
      passwordHash: devPassword,
      role: "STUDENT",
      studentProfile: {
        upsert: {
          create: {
            fullName: "Nolan Rivera",
            registerNumber: "REG-3001",
          },
          update: {
            fullName: "Nolan Rivera",
            registerNumber: "REG-3001",
          },
        },
      },
    },
    create: {
      email: "nolan.rivera@school.edu",
      passwordHash: devPassword,
      role: "STUDENT",
      studentProfile: {
        create: {
          fullName: "Nolan Rivera",
          registerNumber: "REG-3001",
        },
      },
    },
  })

  await prisma.user.upsert({
    where: { email: "samuel.brooks@school.edu" },
    update: {
      passwordHash: devPassword,
      role: "TEACHER",
      staffProfile: {
        upsert: {
          create: {
            fullName: "Samuel Brooks",
            empId: "EMP-T-3002",
          },
          update: {
            fullName: "Samuel Brooks",
            empId: "EMP-T-3002",
          },
        },
      },
    },
    create: {
      email: "samuel.brooks@school.edu",
      passwordHash: devPassword,
      role: "TEACHER",
      staffProfile: {
        create: {
          fullName: "Samuel Brooks",
          empId: "EMP-T-3002",
        },
      },
    },
  })

  await prisma.user.upsert({
    where: { email: "aisha.collins@school.edu" },
    update: {
      passwordHash: devPassword,
      role: "TEACHER",
      staffProfile: {
        upsert: {
          create: {
            fullName: "Aisha Collins",
            empId: "EMP-T-3003",
          },
          update: {
            fullName: "Aisha Collins",
            empId: "EMP-T-3003",
          },
        },
      },
    },
    create: {
      email: "aisha.collins@school.edu",
      passwordHash: devPassword,
      role: "TEACHER",
      staffProfile: {
        create: {
          fullName: "Aisha Collins",
          empId: "EMP-T-3003",
        },
      },
    },
  })

  const devTeacher = await prisma.staffProfile.findUnique({
    where: { empId: "EMP-T-3002" },
    select: { id: true },
  })
  const devTeacherTwo = await prisma.staffProfile.findUnique({
    where: { empId: "EMP-T-3003" },
    select: { id: true },
  })
  const devStudent = await prisma.studentProfile.findUnique({
    where: { registerNumber: "REG-3001" },
    select: { id: true },
  })

  if (!devTeacher || !devTeacherTwo || !devStudent) {
    return NextResponse.json(
      { success: false, message: "Unable to resolve dev profiles." },
      { status: 500 },
    )
  }

  const teacherIdByEmpId: Record<string, string> = {
    "EMP-T-3002": devTeacher.id,
    "EMP-T-3003": devTeacherTwo.id,
  }

  const courseDefs = [
    {
      code: "COURSE-ALG-11",
      name: "Algebra Foundations",
      description: "Linear and quadratic concepts with problem solving practice.",
      credits: 4,
    },
    {
      code: "COURSE-CSI-11",
      name: "Core Science I",
      description: "Physics and chemistry essentials with lab-based reasoning.",
      credits: 4,
    },
    {
      code: "COURSE-STA-12",
      name: "Statistics",
      description: "Descriptive statistics, distributions, and data storytelling.",
      credits: 3,
    },
    {
      code: "COURSE-LIT-11",
      name: "Literature Workshop",
      description: "Close reading, interpretation, and argument-based writing.",
      credits: 3,
    },
    {
      code: "COURSE-CMP-12",
      name: "Computing Essentials",
      description: "Programming fundamentals, data handling, and systems basics.",
      credits: 5,
    },
  ] as const

  const classDefs = [
    { code: "CLASS-10-CEDAR", name: "Grade 10", section: "Cedar", academicYear: 2025 },
    { code: "CLASS-11-MAPLE", name: "Grade 11", section: "Maple", academicYear: 2026 },
    { code: "CLASS-12-OAK", name: "Grade 12", section: "Oak", academicYear: 2026 },
    { code: "CLASS-11-ASH", name: "Grade 11", section: "Ash", academicYear: 2025 },
    { code: "CLASS-12-BIRCH", name: "Grade 12", section: "Birch", academicYear: 2026 },
  ] as const

  const courses = [] as Array<{ id: string; code: string; name: string }>
  for (const item of courseDefs) {
    const course = await prisma.course.upsert({
      where: { code: item.code },
      update: {
        name: item.name,
        description: item.description,
        credits: item.credits,
      },
      create: {
        code: item.code,
        name: item.name,
        description: item.description,
        credits: item.credits,
      },
    })
    courses.push({ id: course.id, code: course.code, name: course.name })
  }

  const classes = [] as Array<{ id: string; code: string; academicYear: number }>
  for (const item of classDefs) {
    const classRoom = await prisma.classRoom.upsert({
      where: { code: item.code },
      update: { name: item.name, section: item.section, academicYear: item.academicYear },
      create: {
        code: item.code,
        name: item.name,
        section: item.section,
        academicYear: item.academicYear,
      },
    })
    classes.push({ id: classRoom.id, code: classRoom.code, academicYear: classRoom.academicYear })
  }

  const offeringDefs = [
    {
      courseCode: "COURSE-ALG-11",
      classCode: "CLASS-10-CEDAR",
      teacherEmpId: "EMP-T-3002",
      term: "Spring-1",
      academicYear: 2025,
      studentLimit: 32,
      registrationOpenAt: "2024-12-10T00:00:00.000Z",
      registrationCloseAt: "2025-01-20T23:59:59.000Z",
      startsOn: "2025-02-01T08:00:00.000Z",
      endsOn: "2025-06-15T08:00:00.000Z",
    },
    {
      courseCode: "COURSE-CSI-11",
      classCode: "CLASS-11-MAPLE",
      teacherEmpId: "EMP-T-3003",
      term: "Spring-1",
      academicYear: 2026,
      studentLimit: 28,
      registrationOpenAt: "2025-12-15T00:00:00.000Z",
      registrationCloseAt: "2026-01-20T23:59:59.000Z",
      startsOn: "2026-02-01T08:00:00.000Z",
      endsOn: "2026-06-20T08:00:00.000Z",
    },
    {
      courseCode: "COURSE-STA-12",
      classCode: "CLASS-12-OAK",
      teacherEmpId: "EMP-T-3002",
      term: "Spring-2",
      academicYear: 2026,
      studentLimit: 24,
      registrationOpenAt: "2025-12-20T00:00:00.000Z",
      registrationCloseAt: "2026-02-10T23:59:59.000Z",
      startsOn: "2026-02-20T08:00:00.000Z",
      endsOn: "2026-07-01T08:00:00.000Z",
    },
    {
      courseCode: "COURSE-LIT-11",
      classCode: "CLASS-11-ASH",
      teacherEmpId: "EMP-T-3003",
      term: "Autumn-2",
      academicYear: 2025,
      studentLimit: 26,
      registrationOpenAt: "2025-06-01T00:00:00.000Z",
      registrationCloseAt: "2025-07-10T23:59:59.000Z",
      startsOn: "2025-07-20T08:00:00.000Z",
      endsOn: "2025-11-30T08:00:00.000Z",
    },
    {
      courseCode: "COURSE-CMP-12",
      classCode: "CLASS-12-BIRCH",
      teacherEmpId: "EMP-T-3002",
      term: "Spring-2",
      academicYear: 2026,
      studentLimit: 20,
      registrationOpenAt: "2026-08-20T00:00:00.000Z",
      registrationCloseAt: "2026-09-25T23:59:59.000Z",
      startsOn: "2026-10-05T08:00:00.000Z",
      endsOn: "2027-01-15T08:00:00.000Z",
    },
  ] as const

  const offerings: Array<{
    id: string
    courseId: string
    classId: string
    courseCode: string
    classCode: string
    teacherId: string
  }> = []
  for (const def of offeringDefs) {
    const course = courses.find((c) => c.code === def.courseCode)
    const classRoom = classes.find((c) => c.code === def.classCode)
    const teacherId = teacherIdByEmpId[def.teacherEmpId]
    if (!course || !classRoom || !teacherId) continue

    const found = await prisma.courseOffering.findFirst({
      where: {
        courseId: course.id,
        classId: classRoom.id,
        term: def.term,
        academicYear: def.academicYear,
      },
    })

    const offering =
      found ??
      (await prisma.courseOffering.create({
        data: {
          courseId: course.id,
          classId: classRoom.id,
          teacherId,
          term: def.term,
          academicYear: def.academicYear,
          studentLimit: def.studentLimit,
          registrationOpenAt: new Date(def.registrationOpenAt),
          registrationCloseAt: new Date(def.registrationCloseAt),
          startsOn: new Date(def.startsOn),
          endsOn: new Date(def.endsOn),
        },
      }))

    if (found) {
      await prisma.courseOffering.update({
        where: { id: found.id },
        data: {
          teacherId,
          studentLimit: def.studentLimit,
          registrationOpenAt: new Date(def.registrationOpenAt),
          registrationCloseAt: new Date(def.registrationCloseAt),
          startsOn: new Date(def.startsOn),
          endsOn: new Date(def.endsOn),
        },
      })
    }

    offerings.push({
      id: offering.id,
      courseId: offering.courseId,
      classId: offering.classId,
      courseCode: def.courseCode,
      classCode: def.classCode,
      teacherId,
    })
  }

  if (offerings.length === 0) {
    return NextResponse.json(
      {
        success: false,
        message: "No course offerings could be seeded. Check teacher/course/class seed data.",
      },
      { status: 500 },
    )
  }

  const extraStudents = await prisma.studentProfile.findMany({
    where: { id: { not: devStudent.id } },
    take: 11,
    select: { id: true },
    orderBy: { createdAt: "asc" },
  })

  const rosterPool = [devStudent.id, ...extraStudents.map((s) => s.id)]

  // 5 students per offering with overlap across offerings.
  const rosterByOffering = offerings.map((offering, oi) => {
    const start = oi * 2
    const base = rosterPool.slice(start, start + 5)
    return {
      offering,
      students: base,
    }
  })

  // Add dev student to the two most populated offerings (first two) and keep intersections.
  for (const bucket of rosterByOffering.slice(0, 2)) {
    if (!bucket.students.includes(devStudent.id)) bucket.students.unshift(devStudent.id)
  }

  // Add one intersection student into every offering.
  const anchor = rosterPool[1]
  if (anchor) {
    for (const bucket of rosterByOffering) {
      if (!bucket.students.includes(anchor)) bucket.students.push(anchor)
    }
  }

  for (const bucket of rosterByOffering) {
    const uniqueStudents = Array.from(new Set(bucket.students))
    for (const studentId of uniqueStudents) {
      await prisma.enrollment.upsert({
        where: {
          studentId_offeringId: {
            studentId,
            offeringId: bucket.offering.id,
          },
        },
        update: { status: "active" },
        create: {
          studentId,
          offeringId: bucket.offering.id,
          status: "active",
        },
      })
    }
  }

  const devAssessments = [
    { kind: "Quiz", title: "Readiness Check", maxMarks: 20 },
    { kind: "Assignment", title: "Practice Worksheet", maxMarks: 30 },
    { kind: "Quiz", title: "Skills Snapshot", maxMarks: 20 },
    { kind: "Assignment", title: "Reflection Task", maxMarks: 35 },
  ] as const

  for (const bucket of rosterByOffering) {
    for (const [index, item] of devAssessments.entries()) {
      const title = `${bucket.offering.courseCode.replace("COURSE-", "")} ${item.title} ${index + 1}`
      const existing = await prisma.assessment.findFirst({
        where: { title, offeringId: bucket.offering.id },
        select: { id: true },
      })

      if (!existing) {
        await prisma.assessment.create({
          data: {
            title,
            type: item.kind === "Quiz" ? "QUIZ" : "ASSIGNMENT",
            dueDate: new Date(Date.UTC(2026, 4, 3 + index * 4 + rosterByOffering.indexOf(bucket))),
            maxMarks: item.maxMarks,
            offeringId: bucket.offering.id,
            classId: bucket.offering.classId,
            courseId: bucket.offering.courseId,
            createdById: bucket.offering.teacherId,
          },
        })
      }
    }
  }

  const assessments = await prisma.assessment.findMany({
    where: { offeringId: { in: offerings.map((o) => o.id) } },
    orderBy: { dueDate: "asc" },
  })

  if (assessments.length === 0) {
    return NextResponse.json(
      {
        success: false,
        message:
          "No assessments could be seeded. Check offering mappings and assessment templates.",
      },
      { status: 500 },
    )
  }

  const offeringTeacherById = new Map(
    offerings.map((offering) => [offering.id, offering.teacherId]),
  )

  const enrollmentRows = await prisma.enrollment.findMany({
    where: { offeringId: { in: offerings.map((o) => o.id) } },
    select: { studentId: true, offeringId: true },
  })
  const enrollmentSet = new Set(enrollmentRows.map((r) => `${r.studentId}:${r.offeringId}`))

  for (const [si, studentId] of rosterPool.entries()) {
    for (const [ai, assessment] of assessments.entries()) {
      if (!enrollmentSet.has(`${studentId}:${assessment.offeringId}`)) continue

      const base = studentId === devStudent.id ? 0.82 : 0.7
      const wobble = (((si + 2) * 11 + (ai + 1) * 5) % 17) / 100 - 0.08
      const pct = Math.max(0.4, Math.min(0.96, base + wobble))
      const marks = Math.round(pct * assessment.maxMarks)
      const percentage = assessment.maxMarks > 0 ? (marks / assessment.maxMarks) * 100 : null

      await prisma.grade.upsert({
        where: {
          assessmentId_studentId: {
            assessmentId: assessment.id,
            studentId,
          },
        },
        update: {
          points: marks,
          maxPoints: assessment.maxMarks,
          percentage,
          source: "TEACHER_OVERRIDE",
          publishedAt: new Date(),
        },
        create: {
          assessmentId: assessment.id,
          studentId,
          points: marks,
          maxPoints: assessment.maxMarks,
          percentage,
          source: "TEACHER_OVERRIDE",
          publishedAt: new Date(),
        },
      })

      if (assessment.type === "ASSIGNMENT") {
        await prisma.submission.upsert({
          where: {
            assessmentId_studentId: {
              assessmentId: assessment.id,
              studentId,
            },
          },
          update: {
            status: "GRADED",
            gradedAt: new Date(),
            gradedById: offeringTeacherById.get(assessment.offeringId),
            feedback: "Seeded feedback: Good structure, improve depth.",
          },
          create: {
            assessmentId: assessment.id,
            studentId,
            submittedAt: new Date(),
            status: "GRADED",
            gradedAt: new Date(),
            gradedById: offeringTeacherById.get(assessment.offeringId),
            feedback: "Seeded feedback: Good structure, improve depth.",
          },
        })
      }
    }
  }

  for (const assessment of assessments.filter((a) => a.type === "QUIZ")) {
    const questionCount = await prisma.question.count({ where: { assessmentId: assessment.id } })
    if (questionCount === 0) {
      // Hand-authored dev questions land published, attributed to the teacher
      // who owns the offering, so the whole modern quiz pipeline (delivery,
      // scoring, attempts) works against seeded data.
      const publishedAt = new Date()
      const publishedById = offeringTeacherById.get(assessment.offeringId) ?? assessment.createdById
      for (let i = 0; i < 5; i++) {
        const correctIndex = i % 4
        await prisma.question.create({
          data: {
            assessmentId: assessment.id,
            type: "MULTIPLE_CHOICE",
            order: i,
            prompt: `Question ${i + 1} for ${assessment.title}`,
            explanation: null,
            points: 1,
            status: "published",
            publishedAt,
            publishedById,
            options: {
              create: ["Option A", "Option B", "Option C", "Option D"].map((text, optionIndex) => ({
                order: optionIndex,
                text,
                isCorrect: optionIndex === correctIndex,
              })),
            },
          },
        })
      }
    }
  }

  const seededEmails = [
    "admin",
    "olivia.hayes@school.edu",
    "teacher.math@school.edu",
    "samuel.brooks@school.edu",
    "aisha.collins@school.edu",
    "ava.t@school.edu",
    "nolan.rivera@school.edu",
  ]

  return NextResponse.json({
    success: true,
    message: "Dummy users and dataset seeded.",
    seededEmails,
  })
}
