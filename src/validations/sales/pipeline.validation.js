const Joi = require('joi');
const {
  PIPELINE_MAX_STAGES,
  PIPELINE_STAGE_KEY_MAX_LENGTH,
  PIPELINE_STAGE_NAME_MAX_LENGTH,
  PROBABILITY_MIN,
  PROBABILITY_MAX,
  TEAM_NAME_MAX_LENGTH,
} = require('../../utils/sales.constants');

/**
 * Validation for the sales Pipeline endpoints. Stages are validated for shape here; the
 * service's normalizeStages enforces the semantic rules (exactly one won + one lost,
 * unique keys, sequential order) so clients can't send an inconsistent pipeline.
 */

// One stage on input: name required; key/order/probability/flags optional (the service
// derives a stable key + sequential order and clamps probability).
const stage = Joi.object({
  key: Joi.string().trim().min(1).max(PIPELINE_STAGE_KEY_MAX_LENGTH),
  name: Joi.string().trim().min(1).max(PIPELINE_STAGE_NAME_MAX_LENGTH).required(),
  order: Joi.number().integer().min(1),
  probability: Joi.number().integer().min(PROBABILITY_MIN).max(PROBABILITY_MAX),
  is_won: Joi.boolean(),
  is_lost: Joi.boolean(),
}).unknown(false);

const stagesList = Joi.array().items(stage).min(1).max(PIPELINE_MAX_STAGES);

const createPipeline = {
  body: Joi.object().keys({
    name: Joi.string().trim().min(1).max(TEAM_NAME_MAX_LENGTH).required(),
    stages: stagesList.required(),
    is_default: Joi.boolean(),
    is_active: Joi.boolean(),
  }),
};

const listPipelines = {
  query: Joi.object().keys({}),
};

const getPipeline = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
};

const updatePipeline = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
  body: Joi.object()
    .keys({
      name: Joi.string().trim().min(1).max(TEAM_NAME_MAX_LENGTH),
      stages: stagesList,
      is_default: Joi.boolean(),
      is_active: Joi.boolean(),
    })
    .min(1),
};

const deletePipeline = {
  params: Joi.object().keys({ uuid: Joi.string().uuid().required() }),
};

module.exports = {
  createPipeline,
  listPipelines,
  getPipeline,
  updatePipeline,
  deletePipeline,
};
