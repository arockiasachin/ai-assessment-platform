export type CourseRegistrationStatus = "open" | "upcoming" | "closed" | "full" | "enrolled" | "waitlisted"

export type CourseCatalogItem = {
  offeringId: string
  courseId: string
  courseCode: string
  courseName: string
  description: string | null
  credits: number
  teacherName: string
  className: string
  term: string
  academicYear: number
  startsOn: string | null
  endsOn: string | null
  registrationOpenAt: string | null
  registrationCloseAt: string | null
  studentLimit: number
  enrolledCount: number
  waitlistedCount: number
  registrationStatus: CourseRegistrationStatus
  canRegister: boolean
  isEnrolled: boolean
  isWaitlisted: boolean
  isCompleted: boolean
  studentRating: number | null
  studentRatingComment: string | null
  averageRating: number | null
  ratingsCount: number
}

export type StudentCoursesPayload = {
  now: string
  enrolledCourses: CourseCatalogItem[]
  offeredCourses: CourseCatalogItem[]
}
