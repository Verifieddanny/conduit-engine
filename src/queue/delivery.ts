import { Queue } from "bullmq";
import IORedis from "ioredis";

export const redisConnection = new IORedis({
    host: process.env.REDIS_HOST || "localhost",
    port: Number(process.env.REDIS_PORT) || 6379,
    maxRetriesPerRequest: null
})

export const deliveryQueue = new Queue("delivery", {
    connection: redisConnection
})

export const addDeliveryJob = async (callbackId: string) => {
    return await deliveryQueue.add("deliver-webhook", { callbackId })
}

