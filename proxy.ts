import { NextRequest, NextResponse } from "next/server";

// Only the admin dashboard routes are password-protected.
// /respond/*, /share/*, /api/*, and static assets are fully public.
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

  const auth = req.headers.get("authorization") ?? "";
  if (auth.startsWith("Basic ")) {
    const decoded = atob(auth.slice(6));
    const [, pass] = decoded.split(":");
    if (pass === password) return NextResponse.next();
  }

  return new NextResponse("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Pulse Admin", charset="UTF-8"',
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.svg|.*\\.mp3|.*\\.js).*)"],
};
