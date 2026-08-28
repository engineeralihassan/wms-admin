const express = require('express');
const validate = require('../../middlewares/validate');
const { authValidation } = require('../../validations');
const authController = require('../../controllers/auth/auth.controller');
const { authVerify } = require('../../middlewares/auth');
const { loginRateLimiter } = require('../../middlewares/rate-limit');

const router = express.Router();

// Public auth endpoints. Login is rate-limited to blunt brute-force attacks.
router.post('/signIn', loginRateLimiter, validate(authValidation.signIn), authController.signIn);
router.post('/refresh', validate(authValidation.refresh), authController.refresh);
router.post('/logout', validate(authValidation.logout), authController.logout);
router.post(
  '/forgot-password',
  loginRateLimiter,
  validate(authValidation.forgotPassword),
  authController.forgotPassword
);
router.post('/reset-password', validate(authValidation.resetPassword), authController.resetPassword);

// Account activation (invite flow): verify the token, then set password + activate.
router.get(
  '/activate/verify',
  loginRateLimiter,
  validate(authValidation.verifyActivation),
  authController.verifyActivation
);
router.post(
  '/activate',
  loginRateLimiter,
  validate(authValidation.activate),
  authController.activate
);

// Protected: returns the current user + resolved authorization context.
router.get('/me', authVerify, authController.getMe);

module.exports = router;
