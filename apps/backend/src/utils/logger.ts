import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname'
    }
  } : undefined
});

export default logger;

// Request logging middleware
export function createRequestLogger() {
  return (req: { method: string; url: string; headers: { [key: string]: string | undefined } }, res: { statusCode: number; once: (name: string, fn: () => void) => void }, done: () => void) => {
    const start = Date.now();
    res.once('finish', () => {
      const duration = Date.now() - start;
      logger.info({
        method: req.method,
        url: req.url,
        status: res.statusCode,
        duration: `${duration}ms`,
        userAgent: req.headers['user-agent']
      }, 'HTTP request');
    });
    done();
  };
}