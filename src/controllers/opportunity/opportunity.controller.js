const httpStatus = require('http-status');
const catchAsync = require('../../utils/catchAsync');
const { opportunityService } = require('../../services');

/** Shape an opportunity for API responses (internal ids are never exposed). */
const toDto = (o) => ({
  uuid: o.uuid,
  source: o.source,
  external_id: o.external_id,
  opportunity_type: o.opportunity_type,
  title: o.title,
  description: o.description,
  company_name: o.company_name,
  company_website: o.company_website,
  employment_type: o.employment_type,
  location: o.location,
  is_remote: o.is_remote,
  salary_min: o.salary_min != null ? Number(o.salary_min) : null,
  salary_max: o.salary_max != null ? Number(o.salary_max) : null,
  salary_currency: o.salary_currency,
  salary_period: o.salary_period,
  salary_display: o.salary_display,
  apply_url: o.apply_url,
  source_url: o.source_url,
  publisher: o.publisher,
  posted_at: o.posted_at,
  discovered_at: o.discovered_at,
  last_seen_at: o.last_seen_at,
  status: o.status,
  search_query: o.search_query,
  converted_at: o.converted_at,
  created_at: o.createdAt,
  updated_at: o.updatedAt,
});

/** Minimal lead summary returned after a conversion (full lead lives under /sales). */
const leadSummary = (l) =>
  l
    ? {
        uuid: l.uuid,
        lead_number: l.lead_number,
        first_name: l.first_name,
        company_name: l.company_name,
        status: l.status,
      }
    : null;

/**
 * POST /opportunities/discover  (opportunity.discover)
 * Run a live search and persist normalized, idempotent opportunities for the org.
 */
const discover = catchAsync(async (req, res) => {
  const { summary, opportunities } = await opportunityService.discover(
    {
      query: req.body.query,
      country: req.body.country,
      datePosted: req.body.date_posted,
      workFromHome: req.body.work_from_home,
      employmentTypes: req.body.employment_types,
      numPages: req.body.num_pages,
    },
    req,
    res
  );
  res.status(httpStatus.OK).send({
    message: res.__('opportunities_discovered'),
    data: { summary, opportunities: opportunities.map(toDto) },
  });
});

/** GET /opportunities  (opportunity.read) */
const list = catchAsync(async (req, res) => {
  const { data, meta } = await opportunityService.listOpportunities(req);
  res.status(httpStatus.OK).send({ message: res.__('success'), data: data.map(toDto), meta });
});

/** GET /opportunities/:uuid  (opportunity.read) */
const getOne = catchAsync(async (req, res) => {
  const opp = await opportunityService.getOpportunity(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('opportunity_found'), data: toDto(opp) });
});

/** PATCH /opportunities/:uuid/status  (opportunity.read) — save / reject / reset. */
const setStatus = catchAsync(async (req, res) => {
  const opp = await opportunityService.setStatus(req.params.uuid, req.body.status, req, res);
  res.status(httpStatus.OK).send({ message: res.__('opportunity_updated'), data: toDto(opp) });
});

/** DELETE /opportunities/:uuid  (opportunity.delete) */
const remove = catchAsync(async (req, res) => {
  await opportunityService.deleteOpportunity(req.params.uuid, req, res);
  res.status(httpStatus.OK).send({ message: res.__('opportunity_deleted'), data: null });
});

/** POST /opportunities/:uuid/convert  (opportunity.convert) — create a Sales Lead. */
const convert = catchAsync(async (req, res) => {
  const { lead, opportunity } = await opportunityService.convertToLead(
    req.params.uuid,
    req.body,
    req,
    res
  );
  res.status(httpStatus.OK).send({
    message: res.__('opportunity_converted'),
    data: { opportunity: toDto(opportunity), lead: leadSummary(lead) },
  });
});

module.exports = { toDto, discover, list, getOne, setStatus, remove, convert };
