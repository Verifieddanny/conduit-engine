import type { Request } from "express";
import type { ValidationError } from "express-validator";
import type { JwtPayload } from "jsonwebtoken";

export type CustomError = Error & {
  statusCode?: number;
  data?: ValidationError[];
};

export interface AuthRequest extends Request {
  userId?: string;
  user?: User;
}

export interface UserPayload extends JwtPayload {
  username: string;
  email: string;
  userId: string;
}

export interface User {
  id: number;
  username: string;
  email: string;
  password: string;
  apiKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}
