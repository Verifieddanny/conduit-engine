import { Router } from "express";
import { getApiKey, login, signup } from "../controller/auth.js";
import { isAuth } from "../middleware/is-auth.js";
import { loginValidation, SignUpValidation } from "../validation/auth.js";


const AuthRouter = Router();


AuthRouter.post("/register", SignUpValidation, signup);

AuthRouter.get("/login", loginValidation, login);

AuthRouter.put("/api-key", isAuth, getApiKey)


export default AuthRouter;