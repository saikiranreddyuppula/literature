import { NextRequest, NextResponse } from 'next/server';
import { SignJWT, jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'literature-game-default-secret-key-2024'
);

export async function middleware(request: NextRequest) {
  const token = request.cookies.get('visitor_token')?.value;
  const requestHeaders = new Headers(request.headers);

  function nextWithVisitor(visitorId: string, jwt?: string) {
    requestHeaders.set('x-visitor-id', visitorId);
    const response = NextResponse.next({
      request: { headers: requestHeaders },
    });
    if (jwt) {
      response.cookies.set('visitor_token', jwt, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 365 * 24 * 60 * 60,
        path: '/',
      });
    }
    return response;
  }

  if (!token) {
    const visitorId = crypto.randomUUID();
    const jwt = await new SignJWT({ visitorId })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('365d')
      .sign(JWT_SECRET);

    return nextWithVisitor(visitorId, jwt);
  } else {
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);
      return nextWithVisitor(payload.visitorId as string);
    } catch {
      const visitorId = crypto.randomUUID();
      const jwt = await new SignJWT({ visitorId })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('365d')
        .sign(JWT_SECRET);

      return nextWithVisitor(visitorId, jwt);
    }
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
