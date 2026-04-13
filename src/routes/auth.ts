import { Router } from "express";
import { getApiKey, login, signup } from "../controller/auth.js";
import { isAuth } from "../middleware/is-auth.js";


let AuthRouter = Router();


AuthRouter.post("/register", signup);

AuthRouter.get("/login", login);

AuthRouter.put("/api-key", isAuth, getApiKey)


export default AuthRouter;