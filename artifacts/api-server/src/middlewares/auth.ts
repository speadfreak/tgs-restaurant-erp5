import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET =
  process.env.JWT_SECRET ??
  process.env.SESSION_SECRET ??
  "tg-erp-secret-2024";

export interface AuthUser {
  id: number;
  role: string;
  branchId: number | null;
  name: string;
  email: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    { id: user.id, role: user.role, branchId: user.branchId, name: user.name, email: user.email },
    JWT_SECRET,
    { expiresIn: "24h" },
  );
}

export function verifyTokenIgnoreExpiry(token: string): AuthUser {
  const payload = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true }) as AuthUser;
  return payload;
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as AuthUser;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function authenticateOptional(req: Request, _res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(auth.slice(7), JWT_SECRET) as AuthUser;
      req.user = payload;
    } catch {
      /* ignore — req.user stays undefined for public callers */
    }
  }
  next();
}

export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden: insufficient role for this portal" });
      return;
    }
    next();
  };
}

export const ADMIN_ROLES = ["super_admin", "branch_manager"];
export const KITCHEN_ROLES = ["kitchen_staff", "super_admin", "branch_manager"];
export const DELIVERY_ROLES = ["delivery_staff", "super_admin", "branch_manager"];
export const ADDIS_ROLES = ["addis_staff", "super_admin"];
export const ORDER_INTAKE_ROLES = ["order_staff", "super_admin", "branch_manager"];
