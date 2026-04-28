import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { pool } from './db';
import type { BufferRequest, CustomError } from './shared/types';
import AuthRouter from './routes/auth';
import { hasApiKey } from './middleware/has-api-key';
import EndpointRouter from './routes/endpoint';
import InboundRouter from './routes/inbound';
import Simulator from './routes/simulator';
import DeliveryRouter from './routes/deliveries';
import { isAuth } from './middleware/is-auth';


const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());

app.use('/api/inbound', express.json({
    verify: (req: BufferRequest, _res, buf) => {
        req.rawBody = buf;
    }
}), InboundRouter)

app.use(express.json());

app.use(
    (error: CustomError, _req: Request, res: Response, _next: NextFunction) => {
        const statusCode = error.statusCode || 500;
        const message = error.message;
        const data = error.data;

        res.status(statusCode).json({ message, data });
    },
);

app.get('/api', (req: Request, res: Response) => {
    res.json({ message: 'Webhook Delivery API is live' });
});

app.use('/api/auth', AuthRouter);
app.use('/api/endpoints', hasApiKey, EndpointRouter);
app.use('/api/simulator', hasApiKey, Simulator);
app.use('/api/deliveries', hasApiKey, DeliveryRouter);

app.use('/api/dashboard/endpoints', isAuth, EndpointRouter);
app.use('/api/dashboard/deliveries', isAuth, DeliveryRouter);
app.use('/api/dashboard/simulator', isAuth, Simulator);


const startServer = async () => {
    try {
        await pool.query(`SELECT 1`);
        console.log("Database connected");

        app.listen(PORT, () => {
            console.log(`🚀 Server running at http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("Failed to connect to database:", error);
        process.exit(1);
    }
};

startServer();