import type { NextFunction, Request, Response } from "express";
import type { AuthRequest, CustomError, UserPayload } from "../shared/types";
import { validationResult } from "express-validator";
import bcrypt from "bcryptjs";
import { db } from "../db";
import { userTable } from "../db/schema";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import { nanoid } from "nanoid";
import { createHash } from "crypto";

export const signup = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            const error: CustomError = new Error("Invalid inputs");
            error.statusCode = 422;
            error.data = errors.array();
            throw error;
        }

        const username = req.body.username;
        const email = req.body.email;
        const password = req.body.password;

        const hashedPassword = await bcrypt.hash(password, 12);

        const [newUser] = await db.insert(userTable).values({
            username,
            email,
            password: hashedPassword
        }).returning()

        if (!newUser) {
            const error: CustomError = new Error("Failed to register user");
            error.statusCode = 500;
            throw error;
        }

        res.status(201).json({
            message: "user created"
        })


    } catch (err) {
        const error = err as CustomError;

        if (!error.statusCode) {
            error.statusCode = 500;
        }

        next(error);
    }
}

export const login = async (
    req: Request,
    res: Response,
    next: NextFunction,
) => {
    try {
        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            const error: CustomError = new Error(
                "Validation failed, entered data is incorrect.",
            );

            error.statusCode = 422;
            error.data = errors.array();
            throw error;
        }

        const username = req.body.username;
        const password = req.body.password;

        const loadedUser = await db.query.userTable.findFirst({
            where: eq(userTable.username, username)
        });

        if (!loadedUser) {
            const error: CustomError = new Error("user not found");

            error.statusCode = 401;
            throw error;
        }

        const isPasswordMatched = await bcrypt.compare(
            password,
            loadedUser.password,
        );

        if (!isPasswordMatched) {
            const error: CustomError = new Error("Invalid password");
            error.statusCode = 401;
            throw error;
        }

        const payload: UserPayload = {
            username: loadedUser.username,
            email: loadedUser.email,
            userId: loadedUser.id.toString(),
        };

        const signOptions: SignOptions = {
            expiresIn: "1h",
        };

        const token = jwt.sign(payload, process.env.SECRETE_KEY!, signOptions);

        res
            .status(200)
            .json({ auth_token: token, userId: loadedUser.id.toString() });
    } catch (error) {
        const err = error as CustomError;
        if (!err.statusCode) {
            err.statusCode = 500;
        }
        next(err);
    }
};

export const getApiKey = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const userId = req.userId;

        if (!userId) {
            const error: CustomError = new Error("user not found");
            error.statusCode = 401;
            throw error;
        }

        const apiKey = `cdt_${nanoid()}`

        const hashedApiKey = createHash("sha256").update(apiKey).digest("hex");

        const updatedUser = await db.update(userTable).set({
            apiKey: hashedApiKey
        }).where(eq(userTable.id, userId))

        if (!updatedUser) {
            const error: CustomError = new Error("Failed to create API KEY");
            error.statusCode = 500;
            throw error;
        }

        res.status(200).json({
            apiKey
        })

    } catch (error) {
        const err = error as CustomError;
        if (!err.statusCode) {
            err.statusCode = 500;
        }
        next(err);
    }
}