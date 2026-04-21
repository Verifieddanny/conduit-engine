import { Worker } from "bullmq";
import { addDeliveryJob, redisConnection } from "./queue/delivery";
import { db } from "./db";
import { callbackTable } from "./db/schema";
import { eq } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { decrypt } from "./service/encryption";

const RETRY_DELAYS = [10, 30, 120, 600, 3600]; // seconds

const worker = new Worker(
    "delivery",
    async (job) => {
        const { callbackId } = job.data;

        console.log(`[Worker] Processing callback: ${callbackId}`);

        const callback = await db.query.callbackTable.findFirst({
            where: eq(callbackTable.id, callbackId),
            with: { endpoint: true }
        })

        if (!callback || !callback.endpoint) {
            throw new Error(`Callback ${callbackId} not found`)
        }

        if (callback.endpoint.status !== "active") {
            console.log(`[Worker] Endpoint inactive, skipping: ${callback.endpoint.id}`);
            await db.update(callbackTable)
                .set({ status: "failed", responseBody: "Endpoint inactive", responseCode: "200" })
                .where(eq(callbackTable.id, callbackId));
            return;
        }

        try {
            const bodyString = callback.payload || "";
            const hmac = createHmac("sha256", decrypt(callback.endpoint.secret));
            const signature = "cdtsig_sha256=" + hmac.update(bodyString).digest("hex");

            const response = await fetch(callback.endpoint.endpointPath, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Conduit-Signature": signature,
                    "X-Conduit-Event": callback.eventType,
                    "X-Conduit-Callback-Id": callback.id,
                },
                body: callback.payload || "{}",
                signal: AbortSignal.timeout(10000)
            })

            const responseBody = await response.text();

            if (response.ok) {
                await db.update(callbackTable)
                    .set({
                        status: "delivered",
                        responseCode: response.status.toString(),
                        responseBody: responseBody.slice(0, 1000),
                        attempts: (callback.attempts || 0) + 1
                    })
                    .where(eq(callbackTable.id, callbackId))
                console.log(`[Worker] Delivered: ${callbackId} (${response.status})`);
            } else {
                if (callback.attempts >= RETRY_DELAYS.length) {
                    await db.update(callbackTable)
                        .set({
                            status: "dead",
                            responseCode: response.status
                                .toString(),
                            responseBody: responseBody.slice(0, 1000),
                        })
                        .where(eq(callbackTable.id, callbackId))

                    console.log(`[Worker] Failed: ${callbackId} (${response.status})`);
                    return
                }

                const baseDelay = (RETRY_DELAYS[(callback.attempts || 0)] || 0) * 1000;
                const jitter = Math.random() * baseDelay
                const totalDelay = baseDelay + jitter;

                addDeliveryJob(callbackId, totalDelay)

                await db.update(callbackTable)
                    .set({
                        status: "failed",
                        responseCode: response.status
                            .toString(),
                        responseBody: responseBody.slice(0, 1000),
                        attempts: (callback.attempts || 0) + 1,
                        nextRetry: new Date(Date.now() + totalDelay).toISOString()
                    })
                    .where(eq(callbackTable.id, callbackId))

                console.log(`[Worker] Failed: ${callbackId} (${response.status}) RETRYING in ${totalDelay / 60000} mins`);
            }
        } catch (error) {
            const err = error as Error;
            if (callback.attempts >= RETRY_DELAYS.length) {
                await db.update(callbackTable)
                    .set({
                        status: "dead",
                        responseCode: 500
                            .toString(),
                        responseBody: err.message,
                    })
                    .where(eq(callbackTable.id, callbackId))

                console.log(`[Worker] Error: ${callbackId} — ${err.message}`);
                return
            }
            const baseDelay = (RETRY_DELAYS[(callback.attempts || 0)] || 0) * 1000;
            const jitter = Math.random() * baseDelay
            const totalDelay = baseDelay + jitter;

            addDeliveryJob(callbackId, totalDelay)

            await db.update(callbackTable)
                .set({
                    status: "failed",
                    responseCode: 500
                        .toString(),
                    responseBody: err.message,
                    attempts: (callback.attempts || 0) + 1,
                    nextRetry: new Date(Date.now() + totalDelay).toISOString()
                })
                .where(eq(callbackTable.id, callbackId))

            console.log(`[Worker] Error: ${callbackId} — ${err.message} RETRYING in ${totalDelay / 60000} mins`);
        }
    },
    {
        connection: redisConnection,
        concurrency: 5
    }
)

worker.on("completed", (job) => {
    console.log(`[Worker] Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
    console.log(`[Worker] Job ${job?.id} failed: ${err.message}`);
});

console.log("🔧 Worker started, listening for jobs...");