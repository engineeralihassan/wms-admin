const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const { organizationService } = require('../../services');
const fileService = require('../../services/storage/file.service');
const { UPLOAD_FOLDERS } = require('../../config/storage');

/**
 * POST /organizations  (super_admin only)
 * Creates an organization and its first org_admin together.
 * Accepts an OPTIONAL multipart `logo` image. The bytes are pushed to storage first;
 * if the DB create then fails, the just-uploaded object is removed so we never leave
 * an orphaned logo behind.
 */
const create = catchAsync(async (req, res) => {
  let logo = null;
  if (req.file) {
    const [descriptor] = await fileService.uploadMany(
      [{ ...req.file, field: req.file.fieldname }],
      { folder: UPLOAD_FOLDERS.ORGANIZATIONS }
    );
    logo = { url: descriptor.url, storageKey: descriptor.key };
  }

  let organization;
  let adminUser;
  try {
    ({ organization, adminUser } = await organizationService.createOrganizationWithAdmin(
      { ...req.body, logo },
      res
    ));
  } catch (err) {
    if (logo) await fileService.removeMany([logo.storageKey]);
    throw err;
  }

  res.status(httpStatus.CREATED).send({
    message: res.__('organization_created'),
    data: {
      organization: {
        id: organization.id,
        uuid: organization.uuid,
        name: organization.name,
        slug: organization.slug,
        is_active: organization.is_active,
        logo_url: organization.logo_url,
      },
      admin: {
        id: adminUser.id,
        uuid: adminUser.uuid,
        email: adminUser.email,
        first_name: adminUser.first_name,
        last_name: adminUser.last_name,
      },
    },
  });
});

/**
 * GET /organizations  (super_admin only)
 */
const list = catchAsync(async (req, res) => {
  const { data, meta } = await organizationService.listOrganizations(req.query);
  res.status(httpStatus.OK).send({
    message: res.__('success'),
    data: data.map((o) => ({
      id: o.id,
      uuid: o.uuid,
      name: o.name,
      slug: o.slug,
      is_active: o.is_active,
      logo_url: o.logo_url,
      // Whether the org's admin has activated their account (drives the "Resend
      // activation" action in the UI). Defaults to true if not annotated.
      admin_activated: o.getDataValue('admin_activated') !== false,
      created_at: o.createdAt,
    })),
    meta,
  });
});

/**
 * PATCH /organizations/:uuid  (super_admin only)
 * Edit an organization's `name` and/or brand `logo`. Accepts an OPTIONAL multipart
 * `logo` image (replaces the current one) or `remove_logo=true` to clear it. The
 * `slug` and identity fields are intentionally NOT editable (see the service).
 */
const update = catchAsync(async (req, res) => {
  let logo = null;
  if (req.file) {
    const [descriptor] = await fileService.uploadMany(
      [{ ...req.file, field: req.file.fieldname }],
      { folder: UPLOAD_FOLDERS.ORGANIZATIONS }
    );
    logo = { url: descriptor.url, storageKey: descriptor.key };
  }

  const removeLogo = req.body.remove_logo === true || req.body.remove_logo === 'true';

  let organization;
  try {
    organization = await organizationService.updateOrganization(
      req.params.uuid,
      { name: req.body.name, logo, removeLogo },
      res
    );
  } catch (err) {
    // If the update failed after we uploaded a new logo, remove the orphaned object.
    if (logo) await fileService.removeMany([logo.storageKey]);
    throw err;
  }

  res.status(httpStatus.OK).send({
    message: res.__('organization_updated'),
    data: {
      id: organization.id,
      uuid: organization.uuid,
      name: organization.name,
      slug: organization.slug,
      is_active: organization.is_active,
      logo_url: organization.logo_url,
      created_at: organization.createdAt,
    },
  });
});

/**
 * POST /organizations/:uuid/resend-invite  (super_admin only)
 * Re-send the activation email to the org's admin if they haven't activated yet.
 */
const resendInvite = catchAsync(async (req, res) => {
  await organizationService.resendOrgActivation(req.params.uuid, res);
  res.status(httpStatus.OK).send({ message: res.__('invite_resent'), data: null });
});

/** PATCH /organizations/:uuid/status — super admin enables or disables a tenant. */
const updateStatus = catchAsync(async (req, res) => {
  const organization = await organizationService.updateOrganizationStatus(
    req.params.uuid,
    req.body.is_active,
    res
  );
  res.status(httpStatus.OK).send({
    message: res.__('success'),
    data: {
      id: organization.id,
      uuid: organization.uuid,
      name: organization.name,
      slug: organization.slug,
      is_active: organization.is_active,
      created_at: organization.createdAt,
    },
  });
});

module.exports = { create, list, update, resendInvite, updateStatus };
