const express = require('express');
const validate = require('../../middlewares/validate');
const { authValidation } = require('../../validations');
const authController = require('../../controllers/auth/auth.controller');
const { authVerify } = require('../../middlewares/auth');
const { loginRateLimiter } = require('../../middlewares/rate-limit');
const uploadFiles = require('../../middlewares/upload');

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

// Self-service password change (session-authenticated; requires the current password).
router.post(
  '/me/password',
  authVerify,
  validate(authValidation.changePassword),
  authController.changePassword
);

// Self-service profile: a logged-in user views/completes their OWN profile + docs.
router.get('/me/profile', authVerify, authController.getMyProfile);
router.patch(
  '/me/profile',
  authVerify,
  validate(authValidation.updateOwnProfile),
  authController.updateMyProfile
);
router.get('/me/documents', authVerify, authController.getMyDocuments);
router.post(
  '/me/documents',
  authVerify,
  // Accept an optional multipart `file` part; the controller streams it to object
  // storage. Runs before validate() so text fields (doc_type, etc.) reach req.body.
  uploadFiles('file'),
  validate(authValidation.uploadOwnDocument),
  authController.uploadMyDocument
);

module.exports = router;
