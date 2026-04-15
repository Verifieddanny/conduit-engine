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

export interface BufferRequest extends Request {
 rawBody?: Buffer<ArrayBufferLike>,
}

export interface UserPayload extends JwtPayload {
  username: string;
  email: string;
  userId: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  password: string;
  apiKey: string | null;
  createdAt: Date;
  updatedAt: Date;
  endpoints?: Endpoint;
}


export interface Endpoint {
  status: "active" | "inactive";
  id: string;
  createdAt: Date;
  updatedAt: Date;
  endpointPath: string;
  secret: string;
  subscribedEvent: string[];
  externalSource: string;
  userId: string;
}

export interface Callback {
  status: "pending" | "delivered" | "failed" | "dead";
  id: string;
  createdAt: Date;
  updatedAt: Date;
  responseCode: string | null;
  responseBody: string | null;
  attempts: number;
  nextRetry: string | null;
  payload: string | null;
  eventType: string;
  endpointId: string;
}