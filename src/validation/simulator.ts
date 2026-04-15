import { body } from "express-validator";

export const simulatorValidation = [
    body("type")
        .trim()
        .notEmpty()
        .withMessage("Invalid simulator event"),
]