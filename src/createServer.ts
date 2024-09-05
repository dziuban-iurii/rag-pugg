import express from 'express';
import { Request, Response } from 'express';
import http from 'http';
import cors from 'cors';
import { promisify } from 'util';
import { config } from './config';

import { logger as customLogger } from './utils/pinoLogger';
import morganMiddleware from './utils/morganLogger';
import { router as versionInfoRouter } from './routers/versionInfo';
import { router as completionRouter } from './routers/completion';
import { router as addIntentRouter } from './routers/addIntent';
import sequelizeConnection from './db/connection';

export const app = express();
const httpServer = http.createServer(app);

const startServer = promisify(httpServer.listen.bind(httpServer));
const stopServer = promisify(httpServer.close.bind(httpServer));

const log = customLogger(__filename);

app.use(express.json());
app.use(cors());
app.use(morganMiddleware);

app.use((_, res, next) => {
  log.info({
    action: 'CORS middleware',
  });
  res.header('Access-Control-Allow-Origin', '*'); // Allow all origins
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

app.options('*', cors(), (req, res) => {
  res.sendStatus(200);
});

app.get('/', (_req, res) =>
  res.status(200).send({
    status: 'OK',
  }),
);

app.use('/api/v1', versionInfoRouter);
app.use('/api/v1', completionRouter);
app.use('/api/v1', addIntentRouter);

app.use((_req, res) => {
  res.status(404).send('Not Found');
});

app.use((err: Error, _req: Request, res: Response) => {
  log.error({
    action: 'appStart',
    result: 'failure',
    e: err.stack,
  });
  res.status(500);
  res.json({ error: 'Something went wrong!' });
});

export async function start(): Promise<void> {
  if (['testing', 'development'].includes(config.NODE_ENV)) {
    // await sequelizeConnection.sync({ alter: true });
  } else {
    // await sequelizeConnection.authenticate();
  }
  log.info({
    action: 'appStart',
    result: 'success',
    msg: 'Starting server...',
  });
  await startServer(process.env.PORT || config.SERVER_PORT);
}

export async function stop(): Promise<void> {
  log.info('Stopping server...');
  sequelizeConnection.close();
  await stopServer();
}
