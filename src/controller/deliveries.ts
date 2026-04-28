import type { NextFunction, Response } from "express";
import type { AuthRequest, CustomError } from "../shared/types";
import { db } from "../db";
import { desc, eq, inArray } from "drizzle-orm";
import { callbackTable, endpointTable } from "../db/schema";
import { addDeliveryJob } from "../queue/delivery";

export const getCallbacks = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const endpointId = req.params.endpointId as string || "";
        const user = req.user;
        const userId = req.userId;


       
         if (!user && !userId) {
            const error: CustomError = new Error("User not found or unauthenticated");
            error.statusCode = 401;
            throw error;
        }

        if (!endpointId) {
            const error: CustomError = new Error("Missing endpoint ID");
            error.statusCode = 400;
            throw error;
        }

        const activeUserId = user ? user.id : userId;


        const endpoint = await db.query.endpointTable.findFirst({
            where: eq(endpointTable.id, endpointId),
            with: {
                callbacks: true
            }
        })

        if (!endpoint || endpoint.userId !== activeUserId) {
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
        const userId = req.userId;


        
         if (!user && !userId) {
            const error: CustomError = new Error("User not found or unauthenticated");
            error.statusCode = 401;
            throw error;
        }

        if (!callbackId) {
            const error: CustomError = new Error("Missing callback ID");
            error.statusCode = 400;
            throw error;
        }

        const activeUserId = user ? user.id : userId;

        const callback = await db.query.callbackTable.findFirst({
            where: eq(callbackTable.id, callbackId),
            with: { endpoint: true }
        });

        if (!callback || !callback.endpoint || callback.endpoint.userId !== activeUserId) {
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


export const getStats = async (req: AuthRequest, res: Response, next:
    NextFunction) => {
    try {
        const userId = req.userId;

        if (!userId) {
            const error: CustomError = new Error("user not found");
            error.statusCode = 401;
            throw error;
        }

        const endpoints = await db.query.endpointTable.findMany({
            where: eq(endpointTable.userId, userId),
            with: { callbacks: true }
        });

        const stats = {
            totalEndpoints: endpoints.length,
            totalDeliveries: 0,
            delivered: 0,
            failed: 0,
            dead: 0
        };

        endpoints.forEach(ep => {
            stats.totalDeliveries += ep.callbacks.length;
            ep.callbacks.forEach(cb => {
                if (cb.status === 'delivered') stats.delivered++;
                else if (cb.status === 'failed') stats.failed++;
                else if (cb.status === 'dead') stats.dead++;
            });
        });

        res.status(200).json(stats);
    } catch (error) {
        next(error);
    }
}

export const getRecentDeliveries = async (req: AuthRequest, res: Response,
    next: NextFunction) => {
    try {
        const userId = req.userId;

        if (!userId) {
            const error: CustomError = new Error("user not found");
            error.statusCode = 401;
            throw error;
        }

        const endpoints = await db.query.endpointTable.findMany({
            where: eq(endpointTable.userId, userId),
            columns: { id: true }
        });

        if (endpoints.length === 0) {
            return res.status(200).json({ deliveries: [] });
        }

        const ids = endpoints.map(e => e.id);

        const recentDeliveries = await db.query.callbackTable.findMany({
            where: inArray(callbackTable.endpointId, ids),
            orderBy: [desc(callbackTable.createdAt)],
            limit: 10,
            with: { endpoint: true }
        });

        res.status(200).json({ deliveries: recentDeliveries });
    } catch (error) {
        next(error);
    }
}
