const express = require('express');
var morgan = require('./config/morgan');

const path = require('path');
const helmet = require('helmet');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const xss = require('xss-clean');
const compression = require('compression');
const { errorConverter, errorHandler } = require('./middlewares/error');
const i18n = require('./config/i18n.config');
const db = require('./models');

const v1Router = require('./routes/v1');

const app = express();

dotenv.config({
  path: path.resolve(process.cwd(), `config.${process.env.NODE_ENV}.env`),
});

// Set security HTTP headers
app.use(helmet());

// Development logging
if (process.env.NODE_ENV === 'DEVELOPMENT') {
  app.use(morgan.successHandler);
  app.use(morgan.errorHandler);
}

// Body parser, reading data from body into req.body
app.use(express.json({ limit: '10kb' }));
// parse urlencoded request body
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Cookie parser
app.use(cookieParser());

// Data sanitization against XSS
app.use(xss());

// Compress all routes

app.use(compression());

// Internationalization
app.use(i18n);

// Serving static files
app.use(express.static(path.join(__dirname, 'public')));

// Enable CORS
app.use(
  cors({
    origin: process.env.CLIENT_URL, // Allow from this origin only, you can add more origins like 'http://example.com' multiple origins separated by comma (,)
    //nultiple origins example : origin: ['http://example.com', 'http://example2.com']
    credentials: true,
  })
);

// Routes
app.use('/api/v1', v1Router);

// Convert error to ApiError, if needed
app.use(errorConverter);

// Error handler, send stacktrace only during development
app.use(errorHandler);

// send back a 404 error for any unknown api request
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint doesnt exist',
    code: 404,
  });
});

const emailWorker = require('./services/email/email.worker');

db.sequelize.sync({ force: false }).then(() => {
  console.log('Database connected');
  emailWorker.start();
});

// Start server
const port = process.env.PORT || 8080;
const server = app.listen(port, () => {
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${port}`);
});

/**
 * Graceful shutdown (important under Docker/PM2/Kubernetes): stop accepting new
 * connections, let the email worker finish in-flight sends and close its SMTP pool,
 * then exit. A hard timeout guards against a hang.
 */
const shutdown = async (signal) => {
  console.log(`${signal} received — shutting down gracefully...`);
  const forceExit = setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
  forceExit.unref();

  server.close(async () => {
    try {
      await emailWorker.stop();
      await db.sequelize.close();
    } catch (err) {
      console.error('Error during shutdown:', err.message);
    } finally {
      clearTimeout(forceExit);
      process.exit(0);
    }
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
