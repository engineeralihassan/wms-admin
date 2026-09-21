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

// Body parser, reading data from body into req.body.
// 1mb comfortably covers rich-text descriptions and other JSON payloads; actual
// file uploads go through multipart/multer, not this JSON parser.
app.use(express.json({ limit: '1mb' }));
// parse urlencoded request body
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Cookie parser
app.use(cookieParser());

// Preserve the raw rich-text job description BEFORE xss-clean escapes it.
// xss-clean HTML-encodes every string in req.body, which turns the description's
// <h2>/<ul>/… into &lt;h2>… and makes it render as literal text on the careers page.
// The job service sanitizes the description with its own allow-list sanitizer
// (utils/sanitize-html), so route handlers can safely restore this raw value.
app.use((req, _res, next) => {
  if (req.body && typeof req.body.description === 'string') {
    req.rawDescription = req.body.description;
  }
  next();
});

// Data sanitization against XSS
app.use(xss());

// Compress all routes

app.use(compression());

// Internationalization
app.use(i18n);

// Serving static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  '/uploads',
  express.static(path.resolve(process.cwd(), process.env.LOCAL_UPLOAD_DIR || 'uploads'))
);

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
const resumeWorker = require('./services/ats/resume/resume.worker');
const timesheetWorker = require('./services/timesheets/timesheet.worker');
const chatWorker = require('./services/chat/chat.worker');
const { initChatGateway } = require('./sockets/chat.gateway');

db.sequelize.sync({ force: false }).then(() => {
  console.log('Database connected');
  emailWorker.start();
  resumeWorker.start();
  timesheetWorker.start();
  chatWorker.start();
});

// Start server
const port = process.env.PORT || 8080;
const server = app.listen(port, () => {
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${port}`);
});

// Attach the Socket.IO chat gateway to the SAME HTTP server (shares the port). The
// REST controllers fan out realtime events through the emitter stored on the app.
const chatGateway = initChatGateway(server);
app.set('chatEvents', chatGateway.chatEvents);

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
      await chatGateway.close();
      await emailWorker.stop();
      await resumeWorker.stop();
      await timesheetWorker.stop();
      await chatWorker.stop();
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
