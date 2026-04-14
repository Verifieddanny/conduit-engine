import { body } from "express-validator";
import { db } from "../db";
import { userTable } from "../db/schema";
import { eq } from "drizzle-orm";


export const SignUpValidation = [
    body("username")
        .notEmpty()
        .trim()
        .custom(async (value, { req }) => {
            return db
                .select()
                .from(userTable)
                .where(eq(userTable.username, value))
                .then((project) => {
                    if (project.length > 0) {
                        return Promise.reject("Username already exists");
                    }
                });
        }),
    body("email")
        .trim()
        .notEmpty()
        .isEmail()
        .withMessage('Put a valid email'),
    body("password")
        .trim()
        .notEmpty()
        .withMessage("Put a valid password")
]

export const loginValidation = [
    body("username")
        .trim()
        .notEmpty()
        .withMessage("Put in a Username"),
    body("password")
        .trim()
        .notEmpty()
        .withMessage("Put a valid password")
]