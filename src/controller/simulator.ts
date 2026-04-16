import type { NextFunction, Response } from "express";
import type { AuthRequest, CustomError } from "../shared/types";
import { db } from "../db";
import { callbackTable, endpointTable } from "../db/schema";
import { validationResult } from "express-validator";
import { and, eq, sql } from "drizzle-orm";
import { addDeliveryJob } from "../queue/delivery";

export const handleSimulator = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            const error: CustomError = new Error("Invalid inputs");
            error.statusCode = 422;
            error.data = errors.array();
            throw error;
        }
        const endpointId = req.params.endpointId as string || "";
        const eventType = req.body.type;
        const user = req.user;

        if (!endpointId || !user) {
            const error: CustomError = new Error("Invalid parameter");
            error.statusCode = 400;
            throw error;
        }
        const endpoint = await db.query.endpointTable.findFirst({
            where: and(
                eq(endpointTable.id, endpointId),
                sql`${endpointTable.subscribedEvent} @> ARRAY[${eventType}]::text[]`
            )
        });

        if (!endpoint || endpoint.userId !== user.id) {
            const error: CustomError = new Error("Not Authorized");
            error.statusCode = 403;
            throw error;
        }

        const [newCallback] = await db.insert(callbackTable).values({
            status: "pending",
            payload: JSON.stringify(req.body),
            eventType: eventType,
            endpointId: endpointId
        }).returning()

        if (!newCallback) {
            const error: CustomError = new Error("failed to create callback");
            error.statusCode = 500;
            throw error;
        }
        await addDeliveryJob(newCallback.id);

        res.status(200).send("Accepted");


    } catch (error) {
        const err = error as CustomError;
        if (!err.statusCode) {
            err.statusCode = 500;
        }
        next(err);
    }
}