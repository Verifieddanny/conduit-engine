import { Router } from "express";
import { simulatorValidation } from "../validation/simulator";
import { handleSimulator } from "../controller/simulator.ts"

const Simulator = Router();

Simulator.post("/:endpointId", simulatorValidation, handleSimulator)

export default Simulator;