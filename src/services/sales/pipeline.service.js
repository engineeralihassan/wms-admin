const httpStatus = require('http-status');
const { SalesPipeline, Deal, User, sequelize } = require('../../models');
const ApiError = require('../../utils/ApiError');
const { normalizeStages } = require('./sales.shared');

/**
 * pipeline.service — per-org sales pipelines (the dynamic stage sets).
 *
 * Pipelines are tenant-scoped by req.tenantWhere. Reading is allowed to any sales reader;
 * creating/editing/deleting is gated by sales.configure at the route. stages are always
 * run through normalizeStages (exactly one won + one lost, sequential order, unique keys)
 * — the same guardrail Job.interview_rounds uses. Editing preserves existing stage keys
 * when provided, so deals' stage_key stays valid.
 */

const PIPELINE_INCLUDE = [
  { model: User, as: 'creator', attributes: ['uuid', 'first_name', 'last_name'] },
];

/** List pipelines (tenant scoped). */
const listPipelines = async (req) =>
  SalesPipeline.findAll({
    where: { ...req.tenantWhere },
    include: PIPELINE_INCLUDE,
    order: [['is_default', 'DESC'], ['created_at', 'ASC']],
  });

/** Fetch a pipeline the caller may see, or throw 404. */
const findVisiblePipeline = async (uuid, req, res, transaction) => {
  const pipeline = await SalesPipeline.findOne({
    where: { uuid, ...req.tenantWhere },
    include: PIPELINE_INCLUDE,
    transaction,
  });
  if (!pipeline) {
    throw new ApiError(httpStatus.NOT_FOUND, res.__('sales_pipeline_not_found'));
  }
  return pipeline;
};

const getPipelineByUuid = async (uuid, req, res) => {
  const pipeline = await findVisiblePipeline(uuid, req, res);
  return { pipeline };
};

/** If this pipeline is being made default, clear is_default on the org's others. */
const clearOtherDefaults = async (organizationId, exceptId, transaction) => {
  await SalesPipeline.update(
    { is_default: false },
    {
      where: {
        organization_id: organizationId,
        is_default: true,
        id: { [require('sequelize').Op.ne]: exceptId || 0 },
      },
      transaction,
    }
  );
};

/** Create a pipeline (stages normalized; may become the default). */
const createPipeline = async (body, req, res) => {
  const organizationId = req.auth.organizationId;

  const pipeline = await sequelize.transaction(async (transaction) => {
    const stages = normalizeStages(body.stages);
    const created = await SalesPipeline.create(
      {
        organization_id: organizationId,
        created_by_id: req.auth.userId,
        name: body.name,
        stages,
        is_default: Boolean(body.is_default),
        is_active: body.is_active !== undefined ? Boolean(body.is_active) : true,
      },
      { transaction }
    );
    if (created.is_default) {
      await clearOtherDefaults(organizationId, created.id, transaction);
    }
    return created;
  });

  return getPipelineByUuid(pipeline.uuid, req, res);
};

/** Update a pipeline's name / stages / default / active flags. */
const updatePipeline = async (uuid, body, req, res) => {
  await sequelize.transaction(async (transaction) => {
    const pipeline = await SalesPipeline.findOne({
      where: { uuid, ...req.tenantWhere },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!pipeline) {
      throw new ApiError(httpStatus.NOT_FOUND, res.__('sales_pipeline_not_found'));
    }
    if (body.name !== undefined) pipeline.name = body.name;
    if (body.stages !== undefined) pipeline.stages = normalizeStages(body.stages);
    if (body.is_active !== undefined) pipeline.is_active = Boolean(body.is_active);
    if (body.is_default !== undefined) pipeline.is_default = Boolean(body.is_default);
    await pipeline.save({ transaction });
    if (pipeline.is_default) {
      await clearOtherDefaults(pipeline.organization_id, pipeline.id, transaction);
    }
  });
  return getPipelineByUuid(uuid, req, res);
};

/**
 * Delete a pipeline. Refuses if any deal still references it (would strand deals) or if
 * it's the org's only pipeline / the default — a safety guard, same spirit as not
 * deleting a job with in-progress applications.
 */
const deletePipeline = async (uuid, req, res) => {
  const pipeline = await findVisiblePipeline(uuid, req, res);

  const dealCount = await Deal.count({
    where: { pipeline_id: pipeline.id, organization_id: pipeline.organization_id },
  });
  if (dealCount > 0) {
    throw new ApiError(httpStatus.CONFLICT, res.__('sales_pipeline_in_use'));
  }
  if (pipeline.is_default) {
    throw new ApiError(httpStatus.CONFLICT, res.__('sales_pipeline_is_default'));
  }

  await SalesPipeline.destroy({ where: { id: pipeline.id } });
};

module.exports = {
  listPipelines,
  findVisiblePipeline,
  getPipelineByUuid,
  createPipeline,
  updatePipeline,
  deletePipeline,
};
