import { jwtVerify, SignJWT } from 'jose';
import { cookies, headers } from 'next/headers';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'literature-game-default-secret-key-2024'
);

export async function getVisitorId(): Promise<string | null> {
  const cookieStore = cookies();
  const token = cookieStore.get('visitor_token')?.value;

  if (token) {
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);
      return payload.visitorId as string;
    } catch {
      // Middleware may have already minted a replacement visitor id for this
      // same request and forwarded it below.
    }
  }

  return headers().get('x-visitor-id');
}

export async function createToken(visitorId: string): Promise<string> {
  return new SignJWT({ visitorId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('365d')
    .sign(JWT_SECRET);
}

export { JWT_SECRET };
