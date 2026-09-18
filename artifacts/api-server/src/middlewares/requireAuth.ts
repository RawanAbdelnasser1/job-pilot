import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getAuth } from "@clerk/express";

export type AuthenticatedRequest = Request & { userId: string };

export const requireAuth: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const auth = getAuth(req);
  const userId = (auth?.sessionClaims?.userId || auth?.userId) as
    | string
    | undefined;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as AuthenticatedRequest).userId = userId;
  next();
};