import "dotenv/config"

import bcrypt from "bcryptjs"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error("DATABASE_URL is not set")
}

const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter })

function shiftDays(iso: string, days: number) {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d
}

async function main() {
  await prisma.calendarEvent.deleteMany()
  await prisma.submission.deleteMany()
  await prisma.quizQuestion.deleteMany()
  await prisma.quiz.deleteMany()
  await prisma.assessmentGrade.deleteMany()
  await prisma.assessment.deleteMany()
  await prisma.enrollment.deleteMany()
  await prisma.courseOffering.deleteMany()
  await prisma.classRoom.deleteMany()
  await prisma.course.deleteMany()
  await prisma.studentProfile.deleteMany()
  await prisma.staffProfile.deleteMany()
  await prisma.user.deleteMany()

  const adminPassword = await bcrypt.hash("admin", 10)
  const teacherPassword = await bcrypt.hash("teacher123", 10)
  const studentPassword = await bcrypt.hash("student123", 10)
  const devPassword = await bcrypt.hash("dev12345", 10)

  const admin = await prisma.user.create({
    data: {
      email: "admin",
      passwordHash: adminPassword,
      role: "ADMIN",
      staffProfile: {
        create: {
          fullName: "System Admin",
          empId: "EMP-ADMIN-001",
          profilePicUrl: "https://picsum.photos/seed/admin/120/120",
        },
      },
    },
    include: { staffProfile: true },
  })

  const teacherA = await prisma.user.create({
    data: {
      email: "teacher.math@school.edu",
      passwordHash: teacherPassword,
      role: "TEACHER",
      staffProfile: {
        create: {
          fullName: "Maya Carter",
          empId: "EMP-T-1001",
          profilePicUrl: "https://picsum.photos/seed/teacher-a/120/120",
        },
      },
    },
    include: { staffProfile: true },
  })

  const teacherB = await prisma.user.create({
    data: {
      email: "teacher.humanities@school.edu",
      passwordHash: teacherPassword,
      role: "TEACHER",
      staffProfile: {
        create: {
          fullName: "Jonah Reeves",
          empId: "EMP-T-1002",
          profilePicUrl: "https://picsum.photos/seed/teacher-b/120/120",
        },
      },
    },
    include: { staffProfile: true },
  })

  const devAdmin = await prisma.user.create({
    data: {
      email: "olivia.hayes@school.edu",
      passwordHash: devPassword,
      role: "ADMIN",
      staffProfile: {
        create: {
          fullName: "Olivia Hayes",
          empId: "EMP-A-3001",
          profilePicUrl: "https://picsum.photos/seed/dev-admin/120/120",
        },
      },
    },
    include: { staffProfile: true },
  })

  const devTeacher = await prisma.user.create({
    data: {
      email: "samuel.brooks@school.edu",
      passwordHash: devPassword,
      role: "TEACHER",
      staffProfile: {
        create: {
          fullName: "Samuel Brooks",
          empId: "EMP-T-3002",
          profilePicUrl: "https://picsum.photos/seed/dev-teacher/120/120",
        },
      },
    },
    include: { staffProfile: true },
  })

  const devStudentUser = await prisma.user.create({
    data: {
      email: "nolan.rivera@school.edu",
      passwordHash: devPassword,
      role: "STUDENT",
      studentProfile: {
        create: {
          fullName: "Nolan Rivera",
          registerNumber: "REG-3001",
          profilePicUrl: "https://picsum.photos/seed/dev-student/120/120",
        },
      },
    },
    include: { studentProfile: true },
  })

  const courseMath = await prisma.course.create({
    data: {
      code: "COURSE-MATH",
      name: "Mathematics",
      description: "Core mathematical reasoning, algebra, and geometry skills.",
      credits: 4,
    },
  })
  const courseScience = await prisma.course.create({
    data: {
      code: "COURSE-SCI",
      name: "Science",
      description: "Foundational physics, chemistry, and life sciences.",
      credits: 4,
    },
  })
  const courseEnglish = await prisma.course.create({
    data: {
      code: "COURSE-ENG",
      name: "English",
      description: "Academic writing, reading comprehension, and literature studies.",
      credits: 3,
    },
  })
  const courseHistory = await prisma.course.create({
    data: {
      code: "COURSE-HIS",
      name: "History",
      description: "World history themes, analysis, and historical writing.",
      credits: 3,
    },
  })

  const classA = await prisma.classRoom.create({
    data: { code: "CLASS-10-A", name: "Grade 10", section: "A", academicYear: 2026 },
  })

  const classB = await prisma.classRoom.create({
    data: { code: "CLASS-10-B", name: "Grade 10", section: "B", academicYear: 2026 },
  })

  const classDev = await prisma.classRoom.create({
    data: { code: "CLASS-11-C", name: "Grade 11", section: "C", academicYear: 2026 },
  })

  const offeringMathA = await prisma.courseOffering.create({
    data: {
      courseId: courseMath.id,
      classId: classA.id,
      teacherId: teacherA.staffProfile!.id,
      term: "Term-1",
      academicYear: 2026,
      studentLimit: 34,
      registrationOpenAt: new Date("2025-12-01T00:00:00.000Z"),
      registrationCloseAt: new Date("2026-01-15T23:59:59.000Z"),
      startsOn: new Date("2026-01-18T08:00:00.000Z"),
      endsOn: new Date("2026-06-10T08:00:00.000Z"),
    },
  })
  const offeringScienceA = await prisma.courseOffering.create({
    data: {
      courseId: courseScience.id,
      classId: classA.id,
      teacherId: teacherA.staffProfile!.id,
      term: "Term-1",
      academicYear: 2026,
      studentLimit: 36,
      registrationOpenAt: new Date("2025-12-03T00:00:00.000Z"),
      registrationCloseAt: new Date("2026-01-16T23:59:59.000Z"),
      startsOn: new Date("2026-01-19T08:00:00.000Z"),
      endsOn: new Date("2026-06-12T08:00:00.000Z"),
    },
  })
  const offeringEnglishA = await prisma.courseOffering.create({
    data: {
      courseId: courseEnglish.id,
      classId: classA.id,
      teacherId: teacherB.staffProfile!.id,
      term: "Term-1",
      academicYear: 2026,
      studentLimit: 30,
      registrationOpenAt: new Date("2025-12-05T00:00:00.000Z"),
      registrationCloseAt: new Date("2026-01-17T23:59:59.000Z"),
      startsOn: new Date("2026-01-20T08:00:00.000Z"),
      endsOn: new Date("2026-06-14T08:00:00.000Z"),
    },
  })
  const offeringHistoryB = await prisma.courseOffering.create({
    data: {
      courseId: courseHistory.id,
      classId: classB.id,
      teacherId: teacherB.staffProfile!.id,
      term: "Term-1",
      academicYear: 2026,
      studentLimit: 28,
      registrationOpenAt: new Date("2025-12-07T00:00:00.000Z"),
      registrationCloseAt: new Date("2026-01-18T23:59:59.000Z"),
      startsOn: new Date("2026-01-21T08:00:00.000Z"),
      endsOn: new Date("2026-06-16T08:00:00.000Z"),
    },
  })
  const offeringMathDev = await prisma.courseOffering.create({
    data: {
      courseId: courseMath.id,
      classId: classDev.id,
      teacherId: devTeacher.staffProfile!.id,
      term: "Term-2",
      academicYear: 2026,
      studentLimit: 18,
      registrationOpenAt: new Date("2026-02-01T00:00:00.000Z"),
      registrationCloseAt: new Date("2026-03-01T23:59:59.000Z"),
      startsOn: new Date("2026-03-05T08:00:00.000Z"),
      endsOn: new Date("2026-07-02T08:00:00.000Z"),
    },
  })
  const offeringScienceDev = await prisma.courseOffering.create({
    data: {
      courseId: courseScience.id,
      classId: classDev.id,
      teacherId: devTeacher.staffProfile!.id,
      term: "Term-2",
      academicYear: 2026,
      studentLimit: 18,
      registrationOpenAt: new Date("2026-02-01T00:00:00.000Z"),
      registrationCloseAt: new Date("2026-03-03T23:59:59.000Z"),
      startsOn: new Date("2026-03-06T08:00:00.000Z"),
      endsOn: new Date("2026-07-04T08:00:00.000Z"),
    },
  })

  const studentSeeds = [
    { name: "Ava Thompson", email: "ava.t@school.edu", reg: "REG-1001", humanities: false },
    { name: "Liam Chen", email: "liam.c@school.edu", reg: "REG-1002", humanities: false },
    {
      name: "Sofia Martinez",
      email: "sofia.m@school.edu",
      reg: "REG-1003",
      humanities: true,
    },
    { name: "Noah Patel", email: "noah.p@school.edu", reg: "REG-1004", humanities: false },
    {
      name: "Mia Johnson",
      email: "mia.j@school.edu",
      reg: "REG-1005",
      humanities: true,
    },
    {
      name: "Ethan Williams",
      email: "ethan.w@school.edu",
      reg: "REG-1006",
      humanities: false,
    },
    {
      name: "Isabella Rossi",
      email: "bella.r@school.edu",
      reg: "REG-1007",
      humanities: true,
    },
    {
      name: "Lucas Nguyen",
      email: "lucas.n@school.edu",
      reg: "REG-1008",
      humanities: false,
    },
  ]

  const students: Array<{ id: string; name: string; reg: string; humanities: boolean }> = []

  for (const seed of studentSeeds) {
    const user = await prisma.user.create({
      data: {
        email: seed.email,
        passwordHash: studentPassword,
        role: "STUDENT",
        studentProfile: {
          create: {
            fullName: seed.name,
            registerNumber: seed.reg,
            profilePicUrl: `https://picsum.photos/seed/${seed.reg.toLowerCase()}/120/120`,
          },
        },
      },
      include: { studentProfile: true },
    })

    const profile = user.studentProfile!
    students.push({
      id: profile.id,
      name: profile.fullName,
      reg: profile.registerNumber,
      humanities: seed.humanities,
    })
  }

  const devStudentProfile = devStudentUser.studentProfile!
  students.push({
    id: devStudentProfile.id,
    name: devStudentProfile.fullName,
    reg: devStudentProfile.registerNumber,
    humanities: false,
  })

  for (const student of students) {
    await prisma.enrollment.createMany({
      data: [
        { studentId: student.id, offeringId: offeringMathA.id },
        { studentId: student.id, offeringId: offeringScienceA.id },
        { studentId: student.id, offeringId: offeringEnglishA.id },
      ],
    })

    if (student.humanities) {
      await prisma.enrollment.create({
        data: { studentId: student.id, offeringId: offeringHistoryB.id },
      })
    }
  }

  // Add focused dev class enrollments so dev teacher and dev student have a rich,
  // isolated data set to validate in dashboards.
  const devRoster = students.slice(0, 5).map((s) => s.id)
  for (const studentId of devRoster) {
    await prisma.enrollment.createMany({
      data: [
        { studentId, offeringId: offeringMathDev.id },
        { studentId, offeringId: offeringScienceDev.id },
      ],
    })
  }

  const assessmentsSeed = [
    {
      title: "Algebra Basics",
      type: "QUIZ",
      date: "2026-01-14",
      maxMarks: 20,
      offering: offeringMathA,
      course: courseMath,
      teacherId: teacherA.staffProfile!.id,
    },
    {
      title: "Cell Biology Write-up",
      type: "ASSIGNMENT",
      date: "2026-01-21",
      maxMarks: 50,
      offering: offeringScienceA,
      course: courseScience,
      teacherId: teacherA.staffProfile!.id,
    },
    {
      title: "Essay: The Great Gatsby",
      type: "ASSIGNMENT",
      date: "2026-01-28",
      maxMarks: 40,
      offering: offeringEnglishA,
      course: courseEnglish,
      teacherId: teacherB.staffProfile!.id,
    },
    {
      title: "World War I Quiz",
      type: "QUIZ",
      date: "2026-02-04",
      maxMarks: 50,
      offering: offeringHistoryB,
      course: courseHistory,
      teacherId: teacherB.staffProfile!.id,
    },
    {
      title: "Quadratic Practice",
      type: "ASSIGNMENT",
      date: "2026-02-11",
      maxMarks: 50,
      offering: offeringMathA,
      course: courseMath,
      teacherId: teacherA.staffProfile!.id,
    },
    {
      title: "Chemical Reactions",
      type: "QUIZ",
      date: "2026-02-18",
      maxMarks: 20,
      offering: offeringScienceA,
      course: courseScience,
      teacherId: teacherA.staffProfile!.id,
    },
    {
      title: "Poetry Analysis",
      type: "ASSIGNMENT",
      date: "2026-02-25",
      maxMarks: 60,
      offering: offeringEnglishA,
      course: courseEnglish,
      teacherId: teacherB.staffProfile!.id,
    },
    {
      title: "Geometry Quiz",
      type: "QUIZ",
      date: "2026-03-04",
      maxMarks: 100,
      offering: offeringMathA,
      course: courseMath,
      teacherId: teacherA.staffProfile!.id,
    },
    {
      title: "Cold War Reflection",
      type: "ASSIGNMENT",
      date: "2026-03-11",
      maxMarks: 40,
      offering: offeringHistoryB,
      course: courseHistory,
      teacherId: teacherB.staffProfile!.id,
    },
    {
      title: "Forces and Motion",
      type: "QUIZ",
      date: "2026-03-18",
      maxMarks: 100,
      offering: offeringScienceA,
      course: courseScience,
      teacherId: teacherA.staffProfile!.id,
    },
    {
      title: "Algebra Sprint",
      type: "QUIZ",
      date: "2026-04-05",
      maxMarks: 30,
      offering: offeringMathDev,
      course: courseMath,
      teacherId: devTeacher.staffProfile!.id,
    },
    {
      title: "Algebra Worksheet",
      type: "ASSIGNMENT",
      date: "2026-04-12",
      maxMarks: 40,
      offering: offeringMathDev,
      course: courseMath,
      teacherId: devTeacher.staffProfile!.id,
    },
    {
      title: "Math Reflection",
      type: "ASSIGNMENT",
      date: "2026-04-19",
      maxMarks: 25,
      offering: offeringMathDev,
      course: courseMath,
      teacherId: devTeacher.staffProfile!.id,
    },
    {
      title: "Science Quiz 1",
      type: "QUIZ",
      date: "2026-04-08",
      maxMarks: 25,
      offering: offeringScienceDev,
      course: courseScience,
      teacherId: devTeacher.staffProfile!.id,
    },
    {
      title: "Lab Notebook",
      type: "ASSIGNMENT",
      date: "2026-04-15",
      maxMarks: 35,
      offering: offeringScienceDev,
      course: courseScience,
      teacherId: devTeacher.staffProfile!.id,
    },
    {
      title: "Science Quiz 2",
      type: "QUIZ",
      date: "2026-04-22",
      maxMarks: 25,
      offering: offeringScienceDev,
      course: courseScience,
      teacherId: devTeacher.staffProfile!.id,
    },
  ] as const

  const createdAssessments: Array<{ id: string; maxMarks: number; type: "QUIZ" | "ASSIGNMENT" }> =
    []

  for (const a of assessmentsSeed) {
    const created = await prisma.assessment.create({
      data: {
        title: a.title,
        type: a.type,
        dueDate: new Date(`${a.date}T08:00:00.000Z`),
        maxMarks: a.maxMarks,
        offeringId: a.offering.id,
        classId: a.offering.classId,
        courseId: a.course.id,
        createdById: a.teacherId,
      },
    })
    createdAssessments.push({
      id: created.id,
      maxMarks: created.maxMarks,
      type: created.type as "QUIZ" | "ASSIGNMENT",
    })
  }

  const tendency: Record<string, number> = {
    "REG-1001": 0.92,
    "REG-1002": 0.78,
    "REG-1003": 0.85,
    "REG-1004": 0.63,
    "REG-1005": 0.71,
    "REG-1006": 0.55,
    "REG-1007": 0.88,
    "REG-1008": 0.68,
    "REG-3001": 0.81,
  }

  const allEnrollments = await prisma.enrollment.findMany({
    select: { studentId: true, offeringId: true },
  })
  const enrollmentSet = new Set(allEnrollments.map((e) => `${e.studentId}:${e.offeringId}`))

  const assessmentOfferings = new Map<string, string>()
  const assessmentRows = await prisma.assessment.findMany({
    where: { id: { in: createdAssessments.map((a) => a.id) } },
    select: { id: true, offeringId: true },
  })
  for (const row of assessmentRows) {
    assessmentOfferings.set(row.id, row.offeringId)
  }

  for (const [si, student] of students.entries()) {
    const base = tendency[student.reg] ?? 0.7

    for (const [ai, assessment] of createdAssessments.entries()) {
      const offeringId = assessmentOfferings.get(assessment.id)
      if (!offeringId) continue
      if (!enrollmentSet.has(`${student.id}:${offeringId}`)) continue

      const wobble = (((si + 1) * 7 + (ai + 1) * 13) % 21) / 100 - 0.1
      let pct = base + wobble
      pct = Math.max(0.35, Math.min(1, pct))

      const marks = Math.round(pct * assessment.maxMarks)

      await prisma.assessmentGrade.create({
        data: {
          assessmentId: assessment.id,
          studentId: student.id,
          marksObtained: marks,
          rubricRef: `mongo:rubrics/${assessment.id}`,
        },
      })

      if (assessment.type === "ASSIGNMENT") {
        await prisma.submission.create({
          data: {
            assessmentId: assessment.id,
            studentId: student.id,
            submittedAt: shiftDays("2026-01-01T09:00:00.000Z", ai + si),
            status: "GRADED",
            artifactUrl: `https://storage.example.com/submissions/${assessment.id}/${student.id}.pdf`,
            gradedAt: shiftDays("2026-01-01T12:00:00.000Z", ai + si),
            gradedById: ai % 2 === 0 ? teacherA.staffProfile!.id : teacherB.staffProfile!.id,
            feedback: "Good attempt. Keep improving structure and accuracy.",
          },
        })
      }
    }
  }

  const quizAssessments = await prisma.assessment.findMany({
    where: { type: "QUIZ" },
    orderBy: { dueDate: "asc" },
  })

  for (const qa of quizAssessments) {
    const quiz = await prisma.quiz.create({
      data: {
        assessmentId: qa.id,
      },
    })

    for (let i = 0; i < 5; i++) {
      await prisma.quizQuestion.create({
        data: {
          quizId: quiz.id,
          order: i + 1,
          prompt: `Question ${i + 1} for ${qa.title}`,
          optionsJson: ["Option A", "Option B", "Option C", "Option D"],
          correctIndex: i % 4,
        },
      })
    }
  }

  const allAssessments = await prisma.assessment.findMany({ orderBy: { dueDate: "asc" } })
  for (const assessment of allAssessments) {
    await prisma.calendarEvent.create({
      data: {
        classId: assessment.classId,
        offeringId: assessment.offeringId,
        assessmentId: assessment.id,
        title: `Upcoming: ${assessment.title}`,
        description: "Assessment due date reminder",
        eventType: "ASSESSMENT",
        startAt: assessment.dueDate,
        isUpcoming: true,
      },
    })
  }

  console.log("Seed complete")
  console.log(`Admin: ${admin.email} / admin`)
  console.log(`Admin account: ${devAdmin.email} / dev12345 (EMP-A-3001)`)
  console.log(`Teacher account: ${devTeacher.email} / dev12345 (EMP-T-3002)`)
  console.log("Student account: nolan.rivera@school.edu / dev12345 (REG-3001)")
  console.log("Teacher login: teacher.math@school.edu / teacher123")
  console.log("Student login: ava.t@school.edu / student123")
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
