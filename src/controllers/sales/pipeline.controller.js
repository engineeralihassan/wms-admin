const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const { pipelineService } = require('../../services');

/** Shape a pipeline for API responses. Internal ids are never exposed. */
const toDto = (p) => ({
  uuid: p.uuid,
  name: p.name,
  stages: Array.isArray(p.stages) ? p.stages : [],
  is_default: p.is_default,
  is_active: p.is_active,
  created_at: p.createdAt,
  updated_at: p.updatedAt,
});

/** GET /sales/pipelines — list. */
const list = catchAsync(async (req, res) => {
  const pipelines = await pipelineService.listPipelines(req, res);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: pipelines.map(toDto) });
});

/** POST /sales/pipelines — create. */
const create = catchAsync(async (req, res) => {
  const { pipeline } = await pipelineService.createPipeline(req.body, req, res);
  res.status(httpStatus.CREATED).send({ message: res.__('sales_pipeline_created'), data: toDto(pipeline) });
});

/** GET /sales/pipelines/:uuid. */
const getOne = catchAsync(async (req, res) => {
  const { pipeline } = await pipelineService.getPipelineByUuid(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('sales_pipeline_found'), data: toDto(pipeline) });
});

/** PATCH /sales/pipelines/:uuid — update. */
const update = catchAsync(async (req, res) => {
  const { pipeline } = await pipelineService.updatePipeline(req.params.uuid, req.body, req, res);
  res.status(httpStatus.OK).send({ message: res.__('sales_pipeline_updated'), data: toDto(pipeline) });
});

/** DELETE /sales/pipelines/:uuid. */
const remove = catchAsync(async (req, res) => {
  await pipelineService.deletePipeline(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('sales_pipeline_deleted'), data: null });
});

module.exports = { toDto, list, create, getOne, update, remove };
