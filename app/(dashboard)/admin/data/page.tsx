import { AdminDatasetsView } from "@/components/admin-datasets-view"
import { RoleGuard } from "@/components/role-guard"
import { AdminPageShell } from "@/components/admin-page-shell"
import { prisma } from "@/lib/prisma"
import { toPlainRows } from "@/lib/admin-db"

// Authenticated, database-backed dashboard: never statically prerender.
export const dynamic = "force-dynamic"

export default async function AdminDataPage() {
  const [
    users,
    staffProfiles,
    studentProfiles,
    courses,
    classRooms,
    courseOfferings,
    enrollments,
    assessments,
    grades,
    submissions,
    quizzes,
    quizQuestions,
    calendarEvents,
    totals,
  ] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, email: true, role: true, createdAt: true },
    }),
    prisma.staffProfile.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, fullName: true, empId: true, userId: true, createdAt: true },
    }),
    prisma.studentProfile.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, fullName: true, registerNumber: true, userId: true, createdAt: true },
    }),
    prisma.course.findMany({ orderBy: { createdAt: "desc" }, take: 25 }),
    prisma.classRoom.findMany({ orderBy: { createdAt: "desc" }, take: 25 }),
    prisma.courseOffering.findMany({
      orderBy: { academicYear: "desc" },
      take: 25,
      select: {
        id: true,
        courseId: true,
        classId: true,
        teacherId: true,
        term: true,
        academicYear: true,
      },
    }),
    prisma.enrollment.findMany({
      orderBy: { enrolledAt: "desc" },
      take: 25,
      select: { id: true, studentId: true, offeringId: true, status: true, enrolledAt: true },
    }),
    prisma.assessment.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        title: true,
        type: true,
        maxMarks: true,
        dueDate: true,
        courseId: true,
        classId: true,
        offeringId: true,
      },
    }),
    prisma.assessmentGrade.findMany({
      orderBy: { gradedAt: "desc" },
      take: 25,
      select: {
        id: true,
        assessmentId: true,
        studentId: true,
        marksObtained: true,
        gradedAt: true,
      },
    }),
    prisma.submission.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        assessmentId: true,
        studentId: true,
        status: true,
        submittedAt: true,
        gradedAt: true,
      },
    }),
    prisma.quiz.findMany({ take: 25, select: { id: true, assessmentId: true } }),
    prisma.quizQuestion.findMany({
      take: 25,
      select: { id: true, quizId: true, order: true, correctIndex: true, prompt: true },
    }),
    prisma.calendarEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        title: true,
        eventType: true,
        startAt: true,
        classId: true,
        offeringId: true,
        assessmentId: true,
      },
    }),
    prisma.$transaction([
      prisma.user.count(),
      prisma.staffProfile.count(),
      prisma.studentProfile.count(),
      prisma.course.count(),
      prisma.classRoom.count(),
      prisma.courseOffering.count(),
      prisma.enrollment.count(),
      prisma.assessment.count(),
      prisma.assessmentGrade.count(),
      prisma.submission.count(),
      prisma.quiz.count(),
      prisma.quizQuestion.count(),
      prisma.calendarEvent.count(),
    ]),
  ])

  const datasets: Array<{ name: string; count: number; rows: Record<string, unknown>[] }> = [
    { name: "users", count: totals[0], rows: toPlainRows(users) },
    { name: "staff_profiles", count: totals[1], rows: toPlainRows(staffProfiles) },
    { name: "student_profiles", count: totals[2], rows: toPlainRows(studentProfiles) },
    { name: "courses", count: totals[3], rows: toPlainRows(courses) },
    { name: "class_rooms", count: totals[4], rows: toPlainRows(classRooms) },
    { name: "course_offerings", count: totals[5], rows: toPlainRows(courseOfferings) },
    { name: "enrollments", count: totals[6], rows: toPlainRows(enrollments) },
    { name: "assessments", count: totals[7], rows: toPlainRows(assessments) },
    { name: "assessment_grades", count: totals[8], rows: toPlainRows(grades) },
    { name: "submissions", count: totals[9], rows: toPlainRows(submissions) },
    { name: "quizzes", count: totals[10], rows: toPlainRows(quizzes) },
    { name: "quiz_questions", count: totals[11], rows: toPlainRows(quizQuestions) },
    { name: "calendar_events", count: totals[12], rows: toPlainRows(calendarEvents) },
  ]

  return (
    <RoleGuard role="admin">
      <AdminPageShell
        title="Data Explorer"
        description="Browse table snapshots and row counts for debugging and QA checks."
      >
        <AdminDatasetsView datasets={datasets} />
      </AdminPageShell>
    </RoleGuard>
  )
}
