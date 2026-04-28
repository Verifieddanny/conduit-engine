import { createHmac, timingSafeEqual } from "crypto";
import type { Response } from "express";
import type { BufferRequest, Callback, CustomError, Endpoint } from "../shared/types";
import { decrypt } from "./encryption";
import { db } from "../db";
import { callbackTable, endpointTable } from "../db/schema";
import { and, arrayContains, eq } from "drizzle-orm";
import { addDeliveryJob } from "../queue/delivery";


export const githubSource = async (req: BufferRequest, res: Response, endpointId: string): Promise<Callback | null> => {

    try {
        const signature = req.headers["x-hub-signature-256"] as string;
        const event = req.headers["x-github-event"] as string;

        if (!signature || !event) {
            res.status(401).json({ message: "Missing Github headers" });
            return null;
        }

        const endpoint = await db.query.endpointTable.findFirst({
            where: and(
                eq(endpointTable.id, endpointId),
                arrayContains(endpointTable.subscribedEvent, [event])
            )
        });

        if (!endpoint) {
            const error: CustomError = new Error("Endpoint not found");
            error.statusCode = 404;
            throw error;
        }


        const bodyBuffer = req.rawBody || Buffer.from(JSON.stringify(req.body));

        let decryptedSecret: string;
        try {
            decryptedSecret = decrypt(endpoint.secret);
        } catch (err) {
            console.error("Decryption failed for GitHub secret:", err);
            res.status(500).json({ message: "Internal security error" });
            return null;
        }


        const hmac = createHmac("sha256", decryptedSecret);
        const digest = "sha256=" + hmac.update(bodyBuffer).digest("hex");

        const trusted = Buffer.from(digest, "ascii");
        const received = Buffer.from(signature, "ascii");

        if (trusted.length !== received.length || !timingSafeEqual(trusted, received)) {
            console.warn(`GitHub Signature mismatch for event: ${event}`);
            res.status(401).json({ message: "Invalid GitHub signature" });
            return null;
        }

        const [newCallback] = await db.insert(callbackTable).values({
            status: "pending",
            payload: JSON.stringify(req.body),
            eventType: event,
            endpointId: endpointId
        }).returning()


        if (!newCallback) {
            const error: CustomError = new Error("failed to create callback");
            error.statusCode = 500;
            throw error;
        }

        await addDeliveryJob(newCallback.id);

        return newCallback;
    } catch (error) {
        console.error("CRITICAL ERROR IN GITHUB SOURCE:", error);
        throw error;
    }
}


export const stripeSource = async (req: BufferRequest, res: Response, endpointId: string): Promise<Callback | null> => {
    try {
        const signature = req.headers["stripe-signature"] as string;
        const event = req.body.type as string;

        if (!signature || !event) {
            res.status(401).json({ message: "Missing Stripe headers" });
            return null;
        }

        const endpoint = await db.query.endpointTable.findFirst({
            where: and(
                eq(endpointTable.id, endpointId),
                arrayContains(endpointTable.subscribedEvent, [event])
            )
        });

        if (!endpoint) {
            res.status(404).json({ message: "Endpoint not found or not subscribed to this event" });
            return null;
        }

        const parts = signature.split(',');
        const timestamp = parts.find(p => p.startsWith('t='))?.split('=')[1];
        const receivedSig = parts.find(p => p.startsWith('v1='))?.split('=')[1];

        if (!timestamp || !receivedSig) {
            console.error("Malformed Stripe Signature Header");
            res.status(401).json({ message: "Invalid signature format" });
            return null;
        }

        const bodyBuffer = req.rawBody || Buffer.from(JSON.stringify(req.body));
        const signedPayload = `${timestamp}.${bodyBuffer.toString('utf8')}`;

        let decryptedSecret: string;
        try {
            decryptedSecret = decrypt(endpoint.secret);
        } catch (err) {
            console.error("Decryption failed for endpoint secret:", err);
            res.status(500).json({ message: "Internal security error" });
            return null;
        }

        const hmac = createHmac("sha256", decryptedSecret);
        const computedSig = hmac.update(signedPayload).digest("hex");

        const isTrusted = timingSafeEqual(
            Buffer.from(computedSig, "hex"),
            Buffer.from(receivedSig, "hex")
        );

        if (!isTrusted) {
            console.warn("Signature mismatch for event:", event);
            res.status(401).json({ message: "Invalid signature" });
            return null;
        }

        console.log("Signature Verified. Creating Callback...");

        const [newCallback] = await db.insert(callbackTable).values({
            status: "pending",
            payload: JSON.stringify(req.body),
            eventType: event,
            endpointId: endpointId
        }).returning();

        if (!newCallback) {
            const error: CustomError = new Error("failed to create callback");
            error.statusCode = 500;
            throw error;
        }


        await addDeliveryJob(newCallback.id);
        return newCallback;

    } catch (error) {
        console.error("CRITICAL ERROR IN STRIPE SOURCE:", error);
        throw error;
    }
}


export const paystackSource = async (req: BufferRequest, res: Response, endpointId: string): Promise<Callback | null> => {

    try {
        const signature = req.headers["x-paystack-signature"] as string;
        const event = req.body.event as string;

        if (!signature || !event) {
            res.status(401).json({ message: "Missing Paystack headers" });
            return null;
        }

        const endpoint = await db.query.endpointTable.findFirst({
            where: and(
                eq(endpointTable.id, endpointId),
                arrayContains(endpointTable.subscribedEvent, [event])
            )
        });

        if (!endpoint) {
            const error: CustomError = new Error("Endpoint not found");
            error.statusCode = 404;
            throw error;
        }
        const bodyBuffer = req.rawBody || Buffer.from(JSON.stringify(req.body));

        let decryptedSecret: string;
        try {
            decryptedSecret = decrypt(endpoint.secret);
        } catch (err) {
            console.error("Decryption failed for Paystack secret:", err);
            res.status(500).json({ message: "Internal security error" });
            return null;
        }

        const hmac = createHmac("sha512", decryptedSecret);
        const digest = hmac.update(bodyBuffer).digest("hex");

        const trusted = Buffer.from(digest, "hex");
        const received = Buffer.from(signature, "hex");

        if (trusted.length !== received.length || !timingSafeEqual(trusted, received)) {
            res.status(401).json({ message: "Invalid signature" });
            return null;
        }

        const [newCallback] = await db.insert(callbackTable).values({
            status: "pending",
            payload: JSON.stringify(req.body),
            eventType: event,
            endpointId: endpointId
        }).returning()


        if (!newCallback) {
            const error: CustomError = new Error("failed to create callback");
            error.statusCode = 500;
            throw error;
        }

        await addDeliveryJob(newCallback.id);

        return newCallback;
    } catch (error) {
        console.error("CRITICAL ERROR IN PAYSTACK SOURCE:", error);
        throw error;

    }
}


export const slackSource = async (req: BufferRequest, res: Response, endpointId: string): Promise<Callback | null> => {

    try {
        const signature = req.headers["x-slack-signature"] as string;
        const timestamp = req.headers["x-slack-request-timestamp"] as string;
        const event = req.body.event?.type || req.body.type;

        if (!signature || !event || !timestamp) {
            res.status(401).json({ message: "Missing Slack headers" });
            return null;
        }


        const endpoint = await db.query.endpointTable.findFirst({
            where: and(
                eq(endpointTable.id, endpointId),
                arrayContains(endpointTable.subscribedEvent, [event])
            )
        });

        if (!endpoint) {
            const error: CustomError = new Error("Endpoint not found");
            error.statusCode = 404;
            throw error;
        }
        const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;

        if (parseInt(timestamp) < fiveMinutesAgo) {
            res.status(401).json({ message: "Replay attack detected" });
            return null;
        }

        const bodyBuffer = req.rawBody || Buffer.from(JSON.stringify(req.body));

        let decryptedSecret: string;
        try {
            decryptedSecret = decrypt(endpoint.secret);
        } catch (err) {
            console.error("Decryption failed for Slack secret:", err);
            res.status(500).json({ message: "Internal security error" });
            return null;
        }


        const baseString = `v0:${timestamp}:${bodyBuffer.toString('utf8')}`;
        const hmac = createHmac("sha256", decryptedSecret);
        const digest = "v0=" + hmac.update(baseString).digest("hex");


        const trusted = Buffer.from(digest, "ascii");
        const received = Buffer.from(signature, "ascii");

        if (trusted.length !== received.length || !timingSafeEqual(trusted, received)) {
            res.status(401).json({ message: "Invalid signature" });
            return null;
        }

        const [newCallback] = await db.insert(callbackTable).values({
            status: "pending",
            payload: JSON.stringify(req.body),
            eventType: event,
            endpointId: endpointId
        }).returning()


        if (!newCallback) {
            const error: CustomError = new Error("failed to create callback");
            error.statusCode = 500;
            throw error;
        }

        await addDeliveryJob(newCallback.id);

        return newCallback;
    } catch (error) {
        console.error("CRITICAL ERROR IN SLACK SOURCE:", error);
        throw error;
    }
}


export const shopifySource = async (req: BufferRequest, res: Response, endpointId: string): Promise<Callback | null> => {

    try {
        const signature = req.headers["x-shopify-hmac-sha256"] as string;
        const event = req.headers["x-shopify-topic"] as string;

        if (!signature || !event) {
            res.status(401).json({ message: "Missing Shopify headers" });
            return null;
        }

        const endpoint = await db.query.endpointTable.findFirst({
            where: and(
                eq(endpointTable.id, endpointId),
                arrayContains(endpointTable.subscribedEvent, [event])
            )
        });

        if (!endpoint) {
            const error: CustomError = new Error("Endpoint not found");
            error.statusCode = 404;
            throw error;
        }

        const bodyBuffer = req.rawBody || Buffer.from(JSON.stringify(req.body));

        let decryptedSecret: string;
        try {
            decryptedSecret = decrypt(endpoint.secret);
        } catch (err) {
            console.error("Decryption failed for GitHub secret:", err);
            res.status(500).json({ message: "Internal security error" });
            return null;
        }


        const hmac = createHmac("sha256", decryptedSecret);
        const digest = hmac.update(bodyBuffer).digest("base64");


        const trusted = Buffer.from(digest, "base64");
        const received = Buffer.from(signature, "base64");

        if (trusted.length !== received.length || !timingSafeEqual(trusted, received)) {
            res.status(401).json({ message: "Invalid signature" });
            return null;
        }

        const [newCallback] = await db.insert(callbackTable).values({
            status: "pending",
            payload: JSON.stringify(req.body),
            eventType: event,
            endpointId: endpointId
        }).returning()


        if (!newCallback) {
            const error: CustomError = new Error("failed to create callback");
            error.statusCode = 500;
            throw error;
        }

        await addDeliveryJob(newCallback.id);

        return newCallback;
    } catch (error) {
        console.error("CRITICAL ERROR IN SHOPIFY SOURCE:", error);
        throw error;
    }
}

export const SOURCE_HANDLERS: Record<string, (req: BufferRequest, res: Response, endpointId: string) => Promise<Callback | null>> = {
    "github": githubSource,
    "stripe": stripeSource,
    "paystack": paystackSource,
    "slack": slackSource,
    "shopify": shopifySource
};