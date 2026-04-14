import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { pool } from './db';
import type { CustomError } from './shared/types';
import AuthRouter from './routes/auth';
import { hasApiKey } from './middleware/has-api-key';
import EndpointRouter from './routes/endpoint';


const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

app.use(
    (error: CustomError, _req: Request, res: Response) => {
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
app.use('/api/endpoints', hasApiKey, EndpointRouter)


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