import jwt from "jsonwebtoken";

const secret = process.env.JWT_SECRET;

if (!secret) {
  throw new Error("JWT_SECRET environment variable is required");
}

export interface TokenPayload {
  sub: string;
  email: string;
  role: string;
  name: string;
}

export function signToken(payload: TokenPayload, expiresIn = "7d"): string {
  return jwt.sign(payload, secret!, { expiresIn } as jwt.SignOptions);
}

export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, secret!) as jwt.JwtPayload & TokenPayload;
  return {
    sub: decoded.sub as string,
    email: decoded.email,
    role: decoded.role,
    name: decoded.name,
  };
}
