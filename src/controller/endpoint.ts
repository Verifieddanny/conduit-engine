import type { NextFunction, Response } from "express";
import type { AuthRequest, CustomError, Endpoint } from "../shared/types";
import { db } from "../db";
import { endpointTable } from "../db/schema";
import crypto from "crypto"
import { encrypt } from "../service/encryption";
import { and, eq } from "drizzle-orm";

export const createEndpoint = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const user = req.user;
        const userId = req.userId;

        if (!user && !userId) {
            const error: CustomError = new Error("user not found");
            error.statusCode = 401;
            throw error;
        }

        const url = req.body.url;
        const subscribedEvents = req.body.subscribed_event as string; //seperated by a ','
        const externalSource = req.body.external_source as string;
        let secret = req.body.secret;
        const subscribedEventsArray = subscribedEvents.split(",");


        if (!secret) {
            secret = crypto.randomBytes(32).toString('hex');
        }
        const activeUserId = user ? user.id : userId;
        const encryptedSecret = encrypt(secret);

        const [newEndpoint] = await db.insert(endpointTable).values({
            endpointPath: url,
            secret: encryptedSecret,
            subscribedEvent: subscribedEventsArray,
            externalSource,
            userId: activeUserId || ""
        }).returning()

        if (!newEndpoint) {
            const error: CustomError = new Error("failed to create endpoint");
            error.statusCode = 500;
            throw error;
        }

        res.status(201).json({
            endpoint: { ...newEndpoint, secret } as Endpoint,
        })

    } catch (error) {
        const err = error as CustomError;
        if (!err.statusCode) {
            err.statusCode = 500;
        }
        next(err);
    }
}

export const getEndpoints = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const user = req.user;
        const userId = req.userId;


        if (!user && !userId) {
            const error: CustomError = new Error("user not found");
            error.statusCode = 401;
            throw error;
        }

        const activeUserId = user ? user.id : userId || "";

        const endpoints = await db.query.endpointTable.findMany({
            where: eq(endpointTable.userId, activeUserId),
            with: {
                callbacks: {
                    columns: {
                        status: true
                    }
                }
            }

        })

        if (!endpoints) {
            const error: CustomError = new Error("No endpoints found");
            error.statusCode = 404;
            throw error;
        }

        const endpointsWithStats = endpoints.map(ep => {
            const stats = {
                deliveredCount: 0,
                failedCount: 0,
                deadCount: 0
            };

            ep.callbacks.forEach(cb => {
                if (cb.status === 'delivered') stats.deliveredCount++;
                else if (cb.status === 'failed') stats.failedCount++;
                else if (cb.status === 'dead') stats.deadCount++;
            });

            const { callbacks, ...endpointData } = ep;
            return { ...endpointData, ...stats };
        });


        res.status(200).json({
            endpoints: endpointsWithStats
        })
    } catch (error) {
        const err = error as CustomError;
        if (!err.statusCode) {
            err.statusCode = 500;
        }
        next(err);
    }
}
export const getEndpoint = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const user = req.user;
        const userId = req.userId;
        const endpointId = req.params.id as string;

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

        // 2. Resolve Active ID
        const activeUserId = user ? user.id : userId!;

        // 3. Fetch Endpoint and Callbacks
        const endpoint = await db.query.endpointTable.findFirst({
            where: and(
                eq(endpointTable.id, endpointId),
                eq(endpointTable.userId, activeUserId)
            ),
            with: {
                callbacks: {
                    columns: {
                        status: true
                    }
                }
            }
        });

        if (!endpoint) {
            const error: CustomError = new Error("Endpoint not found");
            error.statusCode = 404;
            throw error;
        }

        // 4. Correct Aggregation (Reduce, not Map)
        const stats = endpoint.callbacks.reduce((acc, cb) => {
            if (cb.status === 'delivered') acc.deliveredCount++;
            else if (cb.status === 'failed') acc.failedCount++;
            else if (cb.status === 'dead') acc.deadCount++;
            return acc;
        }, { deliveredCount: 0, failedCount: 0, deadCount: 0 });

        // 5. Build Response Object
        // We remove the raw 'callbacks' array from the response to keep it light
        const { callbacks, ...endpointData } = endpoint;

        res.status(200).json({
            endpoint: {
                ...endpointData,
                stats
            }
        });
        
    } catch (error) {
        const err = error as CustomError;
        err.statusCode = err.statusCode || 500;
        next(err);
    }
}

export const updateEndpoint = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const user = req.user;
        const userId = req.userId;
        const endpointId = req.params.id as string || "";

        if (!user && !userId) {
            const error: CustomError = new Error("user not found");
            error.statusCode = 401;
            throw error;
        }

        if (!endpointId) {
            const error: CustomError = new Error("Invalid parameter");
            error.statusCode = 400;
            throw error;
        }

        const url = req.body.url;
        const subscribedEvents = req.body.subscribed_event; //seperated by a ','
        const status = req.body.status as "active" | "inactive";
        const secret = req.body.secret;

        const updateData: Partial<typeof endpointTable.$inferInsert> = {};

        if (url !== undefined) updateData.endpointPath = url;
        if (status !== undefined) updateData.status = status;
        if (subscribedEvents !== undefined) {
            updateData.subscribedEvent = subscribedEvents.split(",");
        }
        if(secret !== undefined) updateData.secret = encrypt(secret);

        if (Object.keys(updateData).length === 0) {
            const error: CustomError = new Error("No update data provided");
            error.statusCode = 400;
            throw error;
        }

        const activeUserId = user ? user.id : userId || "";
        const [updatedEndpoint] = await db
            .update(endpointTable)
            .set(updateData)
            .where(
                and(
                    eq(endpointTable.id, endpointId),
                    eq(endpointTable.userId, activeUserId)
                )
            )
            .returning();

        if (!updatedEndpoint) {
            const error: CustomError = new Error("Endpoint not found or Unauthorized");
            error.statusCode = 403;
            throw error;
        }

        res.status(200).json({
            endpoint: updatedEndpoint
        })
    } catch (error) {
        const err = error as CustomError;
        if (!err.statusCode) {
            err.statusCode = 500;
        }
        next(err);
    }
}

export const deleteEndpoint = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const user = req.user;
        const userId = req.userId;

        const endpointId = req.params.id as string || "";

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
        });

        if (!endpoint) {
            const error: CustomError = new Error("Endpoint not found");
            error.statusCode = 404;
            throw error;
        }

        if (endpoint.userId !== activeUserId) {
            const error: CustomError = new Error("Unauthorized");
            error.statusCode = 403;
            throw error;
        }

        const [deletedEndpoint] = await db.delete(endpointTable).where(eq(endpointTable.id, endpointId)).returning()

        if (!deletedEndpoint) {
            const error: CustomError = new Error("Failed to delete endpoint");
            error.statusCode = 500;
            throw error;
        }

        res.status(200).json({
            message: "Endpoint deleted",
        });
    } catch (error) {
        const err = error as CustomError;
        if (!err.statusCode) {
            err.statusCode = 500;
        }
        next(err);
    }
}