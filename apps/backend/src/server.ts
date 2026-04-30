import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import config from './config';
import { initializeLLM } from './providers/llmClient';
import { errorHandler } from './middleware/errorHandler';

import llmRoutes from './routes/llmRoutes';
import formRoutes from './routes/formRoutes';
import healthRoutes from './routes/healthRoutes';
import configRoutes from './routes/configRoutes';

const app = express();

// Middleware
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api/llm', llmRoutes);
app.use('/api/forms', formRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/config', configRoutes);

// Global error handler
app.use(errorHandler);

async function start(): Promise<void> {
  try {
    try {
      initializeLLM();
      console.log(`LLM provider initialized: ${config.llm.provider}`);
    } catch (initError: any) {
      console.warn(`LLM provider not initialized: ${initError.message}`);
    }

    app.listen(config.port, () => {
      console.log(
        `Browser AI Copilot backend listening on http://${config.host}:${config.port} ` +
        `(provider=${config.llm.provider}, model=${config.llm.model})`
      );
    });
  } catch (error: any) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

export default app;