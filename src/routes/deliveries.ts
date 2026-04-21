import { Router } from "express";
import { getCallbacks, replayCallback } from "../controller/deliveries";


const DeliveryRouter = Router();

DeliveryRouter.get("/:endpointId", getCallbacks)
DeliveryRouter.post("/:callbackId/replay", replayCallback)


export default DeliveryRouter