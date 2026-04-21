import type { NextFunction, Response } from "express";
import type { AuthRequest, CustomError } from "../shared/types";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { callbackTable, endpointTable } from "../db/schema";
import { addDeliveryJob } from "../queue/delivery";

export const getCallbacks = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const endpointId = req.params.endpointId as string || "";
        const user = req.user;

        if (!endpointId || !user) {
            const error: CustomError = new Error("Invalid parameter");
            error.statusCode = 400;
            throw error;
        }

        const endpoint = await db.query.endpointTable.findFirst({
            where: eq(endpointTable.id, endpointId),
            with: {
                callbacks: true
            }
        })

        if (!endpoint || endpoint.userId !== user.id) {
            const error: CustomError = new Error("Not Authorized");
            error.statusCode = 403;
            throw error;
        }

        res.status(200).json({
            callbacks: endpoint.callbacks
        })
    } catch (error) {
        const err = error as CustomError;
        if (!err.statusCode) {
            err.statusCode = 500;
        }
        next(err);
    }

}

export const replayCallback = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const callbackId = req.params.callbackId as string || "";
        const user = req.user;

        if (!callbackId || !user) {
            const error: CustomError = new Error("Invalid parameter");
            error.statusCode = 400;
            throw error;
        }
        const callback = await db.query.callbackTable.findFirst({
            where: eq(callbackTable.id, callbackId),
            with: { endpoint: true }
        });

        if (!callback || !callback.endpoint || callback.endpoint.userId !== user.id) {
            const error: CustomError = new Error("Not Authorized");
            error.statusCode = 403;
            throw error;
        }

        if (callback.status !== "failed" && callback.status !== "dead") {
            const error: CustomError = new Error("Only failed or dead callbacks can be replayed");
            error.statusCode = 400;
            throw error;
        }

        const [updatedCallback] = await db.update(callbackTable).set({
            status: "pending",
            attempts: 0,
            nextRetry: null
        }).where(eq(callbackTable.id, callbackId)).returning()

        if (!updatedCallback) {
            const error: CustomError = new Error("failed to update callback");
            error.statusCode = 500;
            throw error;
        }

        await addDeliveryJob(updatedCallback.id);

        res.status(200).send("Accepted");


    } catch (error) {
        const err = error as CustomError;
        if (!err.statusCode) {
            err.statusCode = 500;
        }
        next(err);
    }
}