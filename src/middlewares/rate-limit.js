const rateLimit = require('express-rate-limit');
const httpStatus = require('http-status');

/**
 * Rate limiter for the login endpoint to blunt brute-force / credential-stuffing.
 * Window and max attempts are configurable via env.
 *
 * Note: for multi-instance deployments behind a load balancer, back this with a
 * shared store (Redis) so the counter is global rather than per-process.
 */
const windowMinutes = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MINUTES || 15);
const maxAttempts = Number(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS || 5);

const loginRateLimiter = rateLimit({
  windowMs: windowMinutes * 60 * 1000,
  max: maxAttempts,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(httpStatus.TOO_MANY_REQUESTS).send({
      code: httpStatus.TOO_MANY_REQUESTS,
      message: res.__ ? res.__('too_many_attempts') : 'Too many attempts. Try again later.',
    });
  },
});

/**
 * Rate limiter for the PUBLIC careers endpoints (unauthenticated). Blunts abuse of the
 * job-view and apply endpoints (spam submissions, scraping). More generous than login
 * since legitimate candidates may view a few jobs, but still bounded per IP window.
 */
const careersWindowMinutes = Number(process.env.CAREERS_RATE_LIMIT_WINDOW_MINUTES || 15);
const careersMax = Number(process.env.CAREERS_RATE_LIMIT_MAX || 30);

const careersRateLimiter = rateLimit({
  windowMs: careersWindowMinutes * 60 * 1000,
  max: careersMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(httpStatus.TOO_MANY_REQUESTS).send({
      code: httpStatus.TOO_MANY_REQUESTS,
      message: res.__ ? res.__('too_many_attempts') : 'Too many requests. Try again later.',
    });
  },
});

/**
 * Rate limiter for sending chat messages. Bounds spam/abuse per authenticated user
 * (keyed by user id, since many users may share one office IP). Runs AFTER authVerify,
 * so req.auth is available. Generous enough for natural conversation.
 */
const chatSendWindowSeconds = Number(process.env.CHAT_SEND_RATE_WINDOW_SECONDS || 10);
const chatSendMax = Number(process.env.CHAT_SEND_RATE_MAX || 20);

const chatSendRateLimiter = rateLimit({
  windowMs: chatSendWindowSeconds * 1000,
  max: chatSendMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.auth && req.auth.userId ? `u:${req.auth.userId}` : req.ip),
  handler: (req, res) => {
    res.status(httpStatus.TOO_MANY_REQUESTS).send({
      code: httpStatus.TOO_MANY_REQUESTS,
      message: res.__ ? res.__('too_many_attempts') : 'Slow down a moment before sending more.',
    });
  },
});

module.exports = { loginRateLimiter, careersRateLimiter, chatSendRateLimiter };
