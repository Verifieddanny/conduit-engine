import { Router } from "express";
import { handleWebhook } from "../controller/inbound";

const InboundRouter = Router();

InboundRouter.post("/:endpointId", handleWebhook)

export default InboundRouter;