const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack, context }) => {
      const contextStr = context ? `[${context}]` : '';
      const logMessage = `${timestamp} ${contextStr} [${level.toUpperCase()}]: ${message}`;
      return stack ? `${logMessage}\n${stack}` : logMessage;
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, context }) => {
          const contextStr = context ? `[${context}]` : '';
          return `${timestamp} ${contextStr} [${level.toUpperCase()}]: ${message}`;
        })
      )
    })
  ]
});

// Function to create a child logger with context
function createLogger(context) {
  return logger.child({ context });
}

// Export logger and helper functions
module.exports = {
  logger,
  createLogger,
  log: {
    info: (message) => logger.info(message),
    warn: (message) => logger.warn(message),
    error: (message) => logger.error(message),
    debug: (message) => logger.debug(message)
  }
};
