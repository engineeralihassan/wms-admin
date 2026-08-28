const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const { organizationService } = require('../../services');

/**
 * POST /organizations  (super_admin only)
 * Creates an organization and its first org_admin together.
 */
const create = catchAsync(async (req, res) => {
  const { organization, adminUser } = await organizationService.createOrganizationWithAdmin(
    req.body,
    res
  );
  res.status(httpStatus.CREATED).send({
    message: res.__('organization_created'),
    data: {
      organization: {
        id: organization.id,
        uuid: organization.uuid,
        name: organization.name,
        slug: organization.slug,
        is_active: organization.is_active,
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
      created_at: o.createdAt,
    })),
    meta,
  });
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

module.exports = { create, list, updateStatus };
