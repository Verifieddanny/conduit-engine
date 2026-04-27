import { Router } from "express";
import { createEndpointValidation, updateEndpointValidation } from "../validation/endpoint";
import { createEndpoint, deleteEndpoint, getEndpoint, getEndpoints, updateEndpoint } from "../controller/endpoint";

const EndpointRouter = Router()

EndpointRouter.post("/", createEndpointValidation, createEndpoint);
EndpointRouter.get("/:id", getEndpoint);
EndpointRouter.get("/", getEndpoints);
EndpointRouter.put("/:id", updateEndpointValidation, updateEndpoint);
EndpointRouter.delete("/:id", deleteEndpoint)



export default EndpointRouter;