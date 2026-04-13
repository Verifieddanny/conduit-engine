import type { NextFunction, Response } from "express";
import jwt from "jsonwebtoken";
import type { CustomError, UserPayload, AuthRequest } from "../shared/types.js";

export const isAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.get("Authorization");

  if (!authHeader) {
    const error = new Error("Not Authenticated") as CustomError;
    error.statusCode = 401;
    return next(error);
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    const error: CustomError = new Error("Not Authenticated!");
    error.statusCode = 401;
    return next(error);
  }

  let decodedToken: UserPayload;

  try {
    decodedToken = jwt.verify(
      token,
      process.env.SECRET!,
    ) as unknown as UserPayload;
  } catch (err) {
    const error = err as CustomError;
    error.message = "Token expired or invalid";
    error.statusCode = 401;
    return next(error);
  }

  if (!decodedToken) {
    const error = new Error("Not Authenticated") as CustomError;
    error.statusCode = 401;
    return next(error);
  }

  req.userId = decodedToken.userId;
  next();
};
