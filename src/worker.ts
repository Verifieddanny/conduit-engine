import { Worker } from "bullmq";
import { redisConnection } from "./queue/delivery";
import { db } from "./db";
import { callbackTable, endpointTable } from "./db/schema";
import { eq } from "drizzle-orm";


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
            const response = await fetch(callback.endpoint.endpointPath, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
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
                await db.update(callbackTable)
                    .set({
                        status: "failed",
                        responseCode: response.status
                            .toString(),
                        responseBody: responseBody.slice(0, 1000),
                        attempts: (callback.attempts || 0) + 1
                    })
                    .where(eq(callbackTable.id, callbackId))

                console.log(`[Worker] Failed: ${callbackId} (${response.status})`);

            }
        } catch (error) {
            const err = error as Error;
            await db.update(callbackTable)
                .set({
                    status: "failed",
                    responseBody: err.message,
                    attempts: (callback.attempts || 0) + 1,
                })
                .where(eq(callbackTable.id, callbackId));

            console.log(`[Worker] Error: ${callbackId} — ${err.message}`);
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