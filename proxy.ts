import { NextRequest, NextResponse } from "next/server";

const PROTECTED = ["/", "/create"];

function isProtected(pathname: string): boolean {
  return PROTECTED.some((p) =>
    p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(p + "/")
  );
}

export function proxy(req: NextRequest) {
  if (!isProtected(req.nextUrl.pathname)) return NextResponse.next();

  const password = process.env.ADMIN_PASSWORD;
  if (!password) return NextResponse.next();

  const cookie = req.cookies.get("pulse_admin");
  if (cookie?.value === password) return NextResponse.next();

  // Redirect to login, preserving the intended destination
  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.svg|.*\\.mp3|.*\\.js|api|login).*)"],
};
