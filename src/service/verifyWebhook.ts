import { createHmac, timingSafeEqual } from "crypto";
import type {Response } from "express";
import type { BufferRequest, Callback, CustomError, Endpoint } from "../shared/types";
import { decrypt } from "./encryption";
import { db } from "../db";
import { callbackTable, endpointTable } from "../db/schema";
import { and, eq, sql } from "drizzle-orm";


export const githubSource = async (req: BufferRequest, res: Response, endpointId: string): Promise<Callback | null> => {

    const signature = req.headers["x-hub-signature-256"] as string;
    const event = req.headers["x-github-event"] as string;

    if (!signature || !event) {
        res.status(401).json({ message: "Missing Github headers" });
        return null;
    }

    const endpoint = await db.query.endpointTable.findFirst({
        where: and(
            eq(endpointTable.id, endpointId),
            sql`${endpointTable.subscribedEvent} @> ${JSON.stringify([event])}::jsonb`
        )
    });

    if (!endpoint) {
        const error: CustomError = new Error("Endpoint not found");
        error.statusCode = 404;
        throw error;
    }


    const bodyString = req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body);
    const hmac = createHmac("sha256", decrypt(endpoint.secret));
    const digest = "sha256=" + hmac.update(bodyString).digest("hex");


    const trusted = Buffer.from(digest);
    const received = Buffer.from(signature);

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

    return newCallback;
}


export const stripeSource = async (req: BufferRequest, res: Response, endpointId: string): Promise<Callback | null> => {

    const signature = req.headers["stripe-signature"] as string;
    const event = req.body.type as string;

    if (!signature || !event) {
        res.status(401).json({ message: "Missing Stripe headers" });
        return null;
    }

    const endpoint = await db.query.endpointTable.findFirst({
        where: and(
            eq(endpointTable.id, endpointId),
            sql`${endpointTable.subscribedEvent} @> ${JSON.stringify([event])}::jsonb`
        )
    });

    if (!endpoint) {
        const error: CustomError = new Error("Endpoint not found");
        error.statusCode = 404;
        throw error;
    }

    const parts = signature.split(',');
    const timestamp = parts.find(p => p.startsWith('t='))?.split('=')[1];
    const receivedSig = parts.find(p => p.startsWith('v1='))?.split('=')[1];
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;

    if (!timestamp || !receivedSig) {
        res.status(401).json({ message: "Invalid signature format" });
        return null;
    }

    if (parseInt(timestamp) < fiveMinutesAgo) {
        res.status(401).json({ message: "Replay attack detected" });
        return null;
    }


    const bodyString = req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body);
    const signedPayload = `${timestamp}.${bodyString}`;

    const hmac = createHmac("sha256", decrypt(endpoint.secret));
    const digest = hmac.update(signedPayload).digest("hex");


    const trusted = Buffer.from(digest);
    const received = Buffer.from(receivedSig);

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

    return newCallback;
}


export const paystackSource = async (req: BufferRequest, res: Response, endpointId: string): Promise<Callback | null> => {

    const signature = req.headers["x-paystack-signature"] as string;
    const event = req.body.event as string;

    if (!signature || !event) {
        res.status(401).json({ message: "Missing Paystack headers" });
        return null;
    }

    const endpoint = await db.query.endpointTable.findFirst({
        where: and(
            eq(endpointTable.id, endpointId),
            sql`${endpointTable.subscribedEvent} @> ${JSON.stringify([event])}::jsonb`
        )
    });

    if (!endpoint) {
        const error: CustomError = new Error("Endpoint not found");
        error.statusCode = 404;
        throw error;
    }

    const bodyString = req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body);

    const hmac = createHmac("sha512", decrypt(endpoint.secret));
    const digest = hmac.update(bodyString).digest("hex");


    const trusted = Buffer.from(digest);
    const received = Buffer.from(signature);

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

    return newCallback;
}


export const slackSource = async (req: BufferRequest, res: Response, endpointId: string): Promise<Callback | null> => {

    const signature = req.headers["x-slack-signature"] as string;
    const event = req.body.event?.type || req.body.type;
    const timestamp = req.headers["x-slack-request-timestamp"] as string;

    if (!signature || !event || !timestamp) {
        res.status(401).json({ message: "Missing Slack headers" });
        return null;
    }

    const endpoint = await db.query.endpointTable.findFirst({
        where: and(
            eq(endpointTable.id, endpointId),
            sql`${endpointTable.subscribedEvent} @> ${JSON.stringify([event])}::jsonb`
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


    const bodyString = req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body);
    const baseString = `v0:${timestamp}:${bodyString}`;

    const hmac = createHmac("sha256", decrypt(endpoint.secret));
    const digest = "v0=" + hmac.update(baseString).digest("hex");


    const trusted = Buffer.from(digest);
    const received = Buffer.from(signature);

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

    return newCallback;
}


export const shopifySource = async (req: BufferRequest, res: Response, endpointId: string): Promise<Callback | null> => {

    const signature = req.headers["x-shopify-hmac-sha256"] as string;
    const event = req.headers["x-shopify-topic"] as string;

    if (!signature || !event) {
        res.status(401).json({ message: "Missing Shopify headers" });
        return null;
    }

    const endpoint = await db.query.endpointTable.findFirst({
        where: and(
            eq(endpointTable.id, endpointId),
            sql`${endpointTable.subscribedEvent} @> ${JSON.stringify([event])}::jsonb`
        )
    });

    if (!endpoint) {
        const error: CustomError = new Error("Endpoint not found");
        error.statusCode = 404;
        throw error;
    }

    const bodyString = req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body);

    const hmac = createHmac("sha256", decrypt(endpoint.secret));
    const digest = hmac.update(bodyString).digest("base64");


    const trusted = Buffer.from(digest);
    const received = Buffer.from(signature);

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

    return newCallback;
}

export const SOURCE_HANDLERS: Record<string, (req: BufferRequest, res: Response, endpointId: string) => Promise<Callback | null>> = {
    "github": githubSource,
    "stripe": stripeSource,
    "paystack": paystackSource,
    "slack": slackSource,
    "shopify": shopifySource
};