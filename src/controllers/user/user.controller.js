const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const { userService } = require('../../services');

const toDto = (user) => ({
  id: user.id,
  uuid: user.uuid,
  first_name: user.first_name,
  last_name: user.last_name,
  email: user.email,
  status: user.status,
  organization_id: user.organization_id,
  manager_id: user.manager_id,
  role: user.role ? { key: user.role.key, name: user.role.name } : undefined,
});

/**
 * POST /users  (requires user.create)
 * org_admin creates a vendor/consultant in their own org; super_admin may target any org.
 */
const create = catchAsync(async (req, res) => {
  const user = await userService.createUser(req.body, req.auth, res);
  res.status(httpStatus.CREATED).send({ message: res.__('userCreated'), data: toDto(user) });
});

/**
 * GET /users  (requires user.read) — tenant + ownership scoped list.
 */
const list = catchAsync(async (req, res) => {
  const { data, meta } = await userService.listUsers(req);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: data.map(toDto), meta });
});

/**
 * GET /users/:uuid  (requires user.read) — tenant + ownership scoped fetch.
 */
const getOne = catchAsync(async (req, res) => {
  const user = await userService.getUserByUuid(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('userFound'), data: toDto(user) });
});

/**
 * POST /users/:uuid/resend-invite  (requires user.create)
 * Re-sends the activation email for an invited user. Tenant + ownership scoped.
 */
const resendInvite = catchAsync(async (req, res) => {
  await userService.resendInvite(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('invite_resent'), data: null });
});

module.exports = { create, list, getOne, resendInvite };
