import type { NextFunction, Response } from "express";
import { createHash } from "crypto";
import type { CustomError, AuthRequest, User } from "../shared/types.js";
import { db } from "../db/index.js";
import { userTable } from "../db/schema.js";
import { eq } from "drizzle-orm";

export const hasApiKey = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.get("Authorization");

    if (!authHeader) {
        const error = new Error("No API KEY") as CustomError;
        error.statusCode = 401;
        throw error
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
        const error: CustomError = new Error("No API KEY!");
        error.statusCode = 401;
        throw error
    }

    let user: User;


    try {
        const hashedKey = createHash('sha256').update(token).digest('hex')

        const loadedUser = await db.query.userTable.findFirst({
            where: eq(userTable.apiKey, hashedKey)
        });

        if (!loadedUser) {
            const error: CustomError = new Error("user not found");

            error.statusCode = 401;
            throw error;
        }

        user = loadedUser;


    } catch (err) {
        const error = err as CustomError;
        error.message = "Api key invalid";
        error.statusCode = 401;
        return next(error);
    }

    if (!user) {
        const error = new Error("No API KEY") as CustomError;
        error.statusCode = 401;
        throw error;
    }

    req.user = user;

    next();
};
