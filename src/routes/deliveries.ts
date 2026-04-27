import { Router } from "express";
import { getCallbacks, getRecentDeliveries, getStats, replayCallback } from "../controller/deliveries";


const DeliveryRouter = Router();

DeliveryRouter.get("/stats", getStats);
DeliveryRouter.get("/recent", getRecentDeliveries);
DeliveryRouter.get("/:endpointId", getCallbacks)
DeliveryRouter.post("/:callbackId/replay", replayCallback)


export default DeliveryRouter