const jwt = require('jsonwebtoken');
const { tokenTypes } = require('../config/tokens');
const { User, Organization } = require('../models');

/**
 * Socket.IO handshake authentication — the WebSocket equivalent of the HTTP
 * `authVerify` middleware. The client connects with its JWT access token via
 * `io(url, { auth: { token } })` (or the Authorization header).
 *
 * It performs the SAME checks as authVerify:
 *  - verifies the access token signature + type,
 *  - does one indexed PK lookup to honor instant revocation (token_version match,
 *    active status, active organization),
 * then attaches the resolved auth context to the socket for the gateway to use.
 *
 * On any failure it calls next(err) so Socket.IO rejects the connection.
 */
const socketAuth = async (socket, next) => {
  try {
    const token =
      (socket.handshake.auth && socket.handshake.auth.token) ||
      extractBearer(socket.handshake.headers && socket.handshake.headers.authorization);

    if (!token) {
      return next(new Error('unauthorized'));
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return next(new Error('unauthorized'));
    }

    if (decoded.type !== tokenTypes.ACCESS) {
      return next(new Error('unauthorized'));
    }

    const user = await User.findByPk(decoded.sub, {
      attributes: ['id', 'uuid', 'token_version', 'status'],
      include: [{ model: Organization, as: 'organization', attributes: ['is_active'] }],
    });

    if (
      !user ||
      user.status !== 'active' ||
      user.token_version !== (decoded.tv ?? 0) ||
      (user.organization && !user.organization.is_active)
    ) {
      return next(new Error('unauthorized'));
    }

    // Mirror req.auth so the gateway can reuse the same shape/logic.
    socket.auth = {
      userId: decoded.sub,
      uuid: decoded.uuid,
      organizationId: decoded.org ?? null,
      role: decoded.role,
      isSuperAdmin: !!decoded.sa,
      permissions: decoded.perms || [],
      tokenVersion: decoded.tv ?? 0,
    };
    return next();
  } catch (err) {
    return next(new Error('unauthorized'));
  }
};

const extractBearer = (authorization) => {
  if (authorization && authorization.split(' ')[0] === 'Bearer') {
    return authorization.split(' ')[1];
  }
  return null;
};

module.exports = { socketAuth };
