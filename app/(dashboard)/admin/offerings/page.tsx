import { RoleGuard } from "@/components/role-guard"
import { AdminPageShell } from "@/components/admin-page-shell"
import { getAdminOfferingsList } from "@/lib/admin-db"

export default async function AdminOfferingsPage() {
  const offerings = await getAdminOfferingsList()

  return (
    <RoleGuard role="admin">
      <AdminPageShell
        title="Course Offerings"
        description="Review course/class assignments, teacher ownership, enrollment load, and assessment density."
      >
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-3 py-2 text-left font-medium">Course</th>
                <th className="px-3 py-2 text-left font-medium">Class</th>
                <th className="px-3 py-2 text-left font-medium">Teacher</th>
                <th className="px-3 py-2 text-left font-medium">Term</th>
                <th className="px-3 py-2 text-left font-medium">Capacity</th>
                <th className="px-3 py-2 text-left font-medium">Enrolled</th>
                <th className="px-3 py-2 text-left font-medium">Assessments</th>
              </tr>
            </thead>
            <tbody>
              {offerings.map((offering) => (
                <tr key={offering.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2">
                    <p className="font-medium">{offering.courseName}</p>
                    <p className="text-xs text-muted-foreground">{offering.courseCode}</p>
                  </td>
                  <td className="px-3 py-2">
                    <p>{offering.className}</p>
                    <p className="text-xs text-muted-foreground">{offering.classCode}</p>
                  </td>
                  <td className="px-3 py-2">
                    <p>{offering.teacherName}</p>
                    <p className="text-xs text-muted-foreground">{offering.teacherEmpId}</p>
                  </td>
                  <td className="px-3 py-2">{offering.term} {offering.academicYear}</td>
                  <td className="px-3 py-2">{offering.capacity}</td>
                  <td className="px-3 py-2">{offering.enrolled}</td>
                  <td className="px-3 py-2">{offering.assessments}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminPageShell>
    </RoleGuard>
  )
}
