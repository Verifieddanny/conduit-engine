import { body } from "express-validator";

export const createEndpointValidation = [
    body("url")
        .trim()
        .notEmpty()
        .isURL()
        .withMessage("Input a valid endpoint"),
    body("subscribed_event")
        .trim()
        .notEmpty()
        .withMessage("Input events to subscribe to"),
    body("external_source")
        .trim()
        .notEmpty()
        .withMessage("Input external source"),
    body("secret")
        .optional()
        .trim()
        .notEmpty()
        .withMessage("Input a status")

]


export const updateEndpointValidation = [
    body("url")
        .optional()
        .trim()
        .notEmpty()
        .isURL()
        .withMessage("Input a valid endpoint"),

    body("subscribed_event")
        .optional()
        .trim()
        .notEmpty()
        .withMessage("Input events to subscribe to"),
    body("status")
        .optional()
        .trim()
        .notEmpty()
        .withMessage("Input a status")
];