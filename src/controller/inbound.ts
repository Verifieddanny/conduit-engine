import type { NextFunction, Response } from "express";
import type { BufferRequest, CustomError } from "../shared/types";
import { SOURCE_HANDLERS } from "../service/verifyWebhook";

type ExternalSource = "stripe" | "github" | "slack" | "paystack" | "shopify";
export const handleWebhook = async (req: BufferRequest, res: Response, next: NextFunction) => {
    try {
        const endpointId = req.params.endpointId as string || "";

        if (!endpointId) {
            const error: CustomError = new Error("Invalid parameter");
            error.statusCode = 400;
            throw error;
        }

        const source: ExternalSource | null = req.headers["x-hub-signature-256"] ? "github" : req.headers["stripe-signature"] ? "stripe" : req.headers["x-paystack-signature"] ? "paystack" : req.headers["x-slack-signature"] ? "slack" : req.headers["x-shopify-hmac-sha256"] ? "shopify" : null

        if (!source) {
            const error: CustomError = new Error("Source not supported atm");
            error.statusCode = 400;
            throw error;
        }

        const handler = SOURCE_HANDLERS[source.toString()];

        if (!handler) return res.status(400).send("Unsupported source");

        const callback = await handler(req, res, endpointId);

        if (!callback) {
            if (!res.headersSent) {
                const error: CustomError = new Error("Failed to create callback");
                error.statusCode = 500;
                throw error;
            }
            return;
        }
         res.status(200).json({
            callbackId: callback.id,
            status: callback.status,
            response: {
                code: 200,
                body: "Accepted"
            }
        });
    } catch (error) {
        const err = error as CustomError;
        if (!err.statusCode) {
            err.statusCode = 500;
        }
        next(err);
    }
}