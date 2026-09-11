import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSessionResponse } from "@/lib/auth";

function toAuthRole(dbRole: "ADMIN" | "TEACHER" | "STUDENT") {
  if (dbRole === "ADMIN") return "admin" as const
  if (dbRole === "TEACHER") return "teacher" as const
  return "student" as const
}

function nameFromEmail(email: string) {
  const raw = email.split("@")[0] ?? "User"
  return raw
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export async function POST(request: Request) {
  try {
    const { email, password, role } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { success: false, message: "Email and password are required." },
        { status: 400 }
      );
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    if (normalizedEmail === "admin" || role === "admin") {
      return NextResponse.json(
        { success: false, message: "The admin account is reserved." },
        { status: 403 }
      );
    }

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (existingUser) {
      return NextResponse.json(
        { success: false, message: "User already exists." },
        { status: 409 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const normalizedRole = role === "teacher" ? "TEACHER" : "STUDENT";

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash: hashedPassword,
        role: normalizedRole,
      },
    });

    if (normalizedRole === "TEACHER") {
      await prisma.staffProfile.create({
        data: {
          userId: user.id,
          fullName: nameFromEmail(normalizedEmail),
          empId: `EMP-${Date.now()}`,
        },
      })
    } else {
      await prisma.studentProfile.create({
        data: {
          userId: user.id,
          fullName: nameFromEmail(normalizedEmail),
          registerNumber: `REG-${Date.now()}`,
        },
      })
    }

    return createSessionResponse({
      id: user.id,
      email: user.email,
      role: toAuthRole(user.role),
    });
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { success: false, message: "Server error." },
      { status: 500 }
    );
  }
}
