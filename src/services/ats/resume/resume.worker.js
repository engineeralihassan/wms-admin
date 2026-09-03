const os = require('os');
const { Op } = require('sequelize');
const {
  ResumeScreeningJob,
  JobApplication,
  Job,
  Attachment,
  ApplicationEvent,
  sequelize,
} = require('../../../models');
const { config } = require('../../../config/ai');
const { match, ScreeningError } = require('./rezmatch.client');
const {
  SCREENING_STATUSES,
  APPLICATION_EVENT_TYPES,
  APPLICATION_ATTACHMENT_OWNER_TYPE,
} = require('../../../utils/ats.constants');
const logger = require('../../../config/logger');

/**
 * Background resume-screening worker — the exact durable-queue pattern used by the
 * email worker (SELECT ... FOR UPDATE SKIP LOCKED claim, drain loop, exponential
 * backoff, stale-lock self-healing), applied to Rezmatch scoring.
 *
 * Per job: resolve the application + its CV + the parent job's description, call
 * Rezmatch ONCE, and persist the score/band/breakdown onto the application. The score
 * is cached, so ranking never calls the API again.
 *
 * Safe to run as multiple instances: claiming is atomic, so no application is scored
 * twice concurrently. Concurrency is kept low by default to respect provider limits.
 */
const WORKER_ID = `${os.hostname()}#${process.pid}`;
const { pollIntervalMs, batchSize, concurrency, staleLockMs } = config.worker;

let running = false;
let stopping = false;
let loopPromise = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff: attempt^2 minutes (1st ~1min, 2nd ~4min, 3rd ~9min). */
const backoffMs = (attempt) => attempt * attempt * 60 * 1000;

/** Strip HTML tags + collapse whitespace so the JD is clean plain text for the matcher. */
const htmlToText = (html = '') =>
  String(html)
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/**
 * Build the job-description text sent to the matcher: the job's own description plus a
 * short, optional "must-have" addendum from the recruiter's screening_criteria. Keeping
 * the criteria as appended text lets Rezmatch weigh them without a bespoke schema.
 */
const buildJdText = (job) => {
  const parts = [`Job Title: ${job.title}`];
  const desc = htmlToText(job.description);
  if (desc) parts.push(desc);

  const c = job.screening_criteria || {};
  const extras = [];
  if (Array.isArray(c.must_have_skills) && c.must_have_skills.length) {
    extras.push(`Required skills: ${c.must_have_skills.join(', ')}`);
  }
  if (Array.isArray(c.keywords) && c.keywords.length) {
    extras.push(`Important keywords: ${c.keywords.join(', ')}`);
  }
  if (c.min_experience != null) {
    extras.push(`Minimum experience: ${c.min_experience} years`);
  }
  // Fall back to the job's own skills/experience if no explicit criteria were set.
  if (!extras.length) {
    if (Array.isArray(job.skills) && job.skills.length) {
      extras.push(`Key skills: ${job.skills.join(', ')}`);
    }
    if (job.experience_min != null) {
      extras.push(`Minimum experience: ${job.experience_min} years`);
    }
  }
  if (extras.length) parts.push(`\nMust-have requirements:\n- ${extras.join('\n- ')}`);
  return parts.join('\n\n');
};

/** Pick the best CV attachment for an application (prefer a PDF/doc named like a CV). */
const pickResume = (attachments = []) => {
  if (!attachments.length) return null;
  const isDoc = (a) => {
    const m = (a.file_mime || '').toLowerCase();
    const n = (a.file_name || '').toLowerCase();
    return (
      m.includes('pdf') ||
      m.includes('word') ||
      m.includes('officedocument') ||
      /\.(pdf|docx?|txt)$/.test(n)
    );
  };
  // Prefer the field explicitly named 'cv', then any doc, then the first attachment.
  return (
    attachments.find((a) => (a.field_name || '').toLowerCase() === 'cv' && isDoc(a)) ||
    attachments.find(isDoc) ||
    attachments[0]
  );
};

/**
 * Atomically claim a batch of runnable jobs (due-pending OR stale-processing).
 * SELECT ... FOR UPDATE SKIP LOCKED so multiple workers never claim the same rows.
 */
const claimJobs = async () => {
  return sequelize.transaction(async (transaction) => {
    const now = new Date();
    const staleThreshold = new Date(now.getTime() - staleLockMs);

    const jobs = await ResumeScreeningJob.findAll({
      where: {
        [Op.or]: [
          { status: 'pending', scheduled_at: { [Op.lte]: now } },
          { status: 'processing', locked_at: { [Op.lt]: staleThreshold } },
        ],
      },
      order: [['scheduled_at', 'ASC']],
      limit: batchSize,
      lock: transaction.LOCK.UPDATE,
      skipLocked: true,
      transaction,
    });

    if (jobs.length === 0) return [];

    const ids = jobs.map((j) => j.id);
    await ResumeScreeningJob.update(
      { status: 'processing', locked_at: now, locked_by: WORKER_ID },
      { where: { id: { [Op.in]: ids } }, transaction }
    );
    return jobs;
  });
};

/** Mark the queue job done and clear its lock. */
const finishJob = (job, patch) =>
  job.update({ locked_at: null, locked_by: null, processed_at: new Date(), ...patch });

/** Handle a failure with retry/backoff classification (mirrors the email worker). */
const failJob = async (job, err) => {
  const attempt = job.attempts + 1;
  const retryable = !(err instanceof ScreeningError) || err.retryable;
  const exhausted = !retryable || attempt >= job.max_attempts;

  await job.update({
    status: exhausted ? 'failed' : 'pending',
    attempts: attempt,
    last_error: err.message,
    scheduled_at: exhausted ? job.scheduled_at : new Date(Date.now() + backoffMs(attempt)),
    locked_at: null,
    locked_by: null,
    processed_at: exhausted ? new Date() : job.processed_at,
  });

  // On terminal failure, reflect it on the application so the UI can show "couldn't screen".
  if (exhausted) {
    await JobApplication.update(
      { screening_status: SCREENING_STATUSES.FAILED, screened_at: new Date() },
      { where: { id: job.application_id } }
    ).catch(() => {});
  }

  logger.warn(
    `[resume:worker] job ${job.id} attempt ${attempt} failed: ${err.message}` +
      (exhausted ? ' (giving up)' : ' (will retry)')
  );
};

/** Process a single claimed screening job end-to-end. */
const processJob = async (job) => {
  const attempt = job.attempts + 1;
  try {
    const application = await JobApplication.findByPk(job.application_id, {
      include: [
        {
          model: Job,
          as: 'job',
          attributes: [
            'id',
            'title',
            'description',
            'skills',
            'experience_min',
            'screening_criteria',
          ],
        },
      ],
    });

    // Application (or its job) is gone — nothing to do; complete quietly.
    if (!application || !application.job) {
      await finishJob(job, { status: 'done', attempts: attempt });
      return 'skipped';
    }

    await application.update({ screening_status: SCREENING_STATUSES.PROCESSING });

    const attachments = await Attachment.findAll({
      where: {
        owner_type: APPLICATION_ATTACHMENT_OWNER_TYPE,
        owner_id: application.id,
      },
      order: [['created_at', 'ASC']],
    });
    const resume = pickResume(attachments);

    // No usable CV -> mark skipped (not a failure; there's just nothing to score).
    if (!resume || !resume.url) {
      await application.update({
        screening_status: SCREENING_STATUSES.SKIPPED,
        screened_at: new Date(),
      });
      await finishJob(job, { status: 'done', attempts: attempt });
      return 'skipped';
    }

    // Guard against oversized CVs (slowest to parse, likeliest to time out / waste
    // credits). Skip gracefully with a reason rather than attempting the call.
    const maxBytes = config.rezmatch.maxResumeBytes;
    if (maxBytes > 0 && resume.file_size && resume.file_size > maxBytes) {
      const mb = (maxBytes / (1024 * 1024)).toFixed(0);
      await application.update({
        screening_status: SCREENING_STATUSES.SKIPPED,
        screening_breakdown: {
          summary: `CV skipped: file larger than ${mb} MB is too large to auto-screen.`,
          provider: 'rezmatch',
        },
        screened_at: new Date(),
      });
      await finishJob(job, { status: 'done', attempts: attempt });
      logger.info(`[resume:worker] job ${job.id} skipped — CV ${resume.file_size} bytes > ${maxBytes}`);
      return 'skipped';
    }

    const jdText = buildJdText(application.job);
    const result = await match({ resumeUrl: resume.url, jdText });

    await sequelize.transaction(async (transaction) => {
      await application.update(
        {
          screening_status: SCREENING_STATUSES.DONE,
          screening_score: result.score,
          screening_band: result.band,
          screening_breakdown: result.breakdown,
          screened_at: new Date(),
        },
        { transaction }
      );
      await ApplicationEvent.create(
        {
          organization_id: application.organization_id,
          application_id: application.id,
          created_by_id: null, // system action
          entry_type: APPLICATION_EVENT_TYPES.SCREENED,
          from_value: null,
          to_value: result.score == null ? null : String(result.score),
          note: result.breakdown?.summary || null,
        },
        { transaction }
      );
      await finishJob(job, { status: 'done', attempts: attempt });
    });

    return 'done';
  } catch (err) {
    await failJob(job, err);
    return 'failed';
  }
};

/** Process a claimed batch in parallel chunks of `concurrency`. */
const processBatch = async (jobs) => {
  let done = 0;
  let failed = 0;
  for (let i = 0; i < jobs.length; i += concurrency) {
    const chunk = jobs.slice(i, i + concurrency);
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(chunk.map((job) => processJob(job)));
    for (const r of results) {
      if (r === 'failed') failed += 1;
      else done += 1;
    }
    if (stopping) break;
  }
  return { done, failed };
};

/** The drain loop: claim + process until empty, then idle for pollIntervalMs. */
const runLoop = async () => {
  running = true;
  logger.info(
    `[resume:worker] started (${WORKER_ID}) batch=${batchSize} concurrency=${concurrency}`
  );
  while (!stopping) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const jobs = await claimJobs();
      if (jobs.length === 0) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(pollIntervalMs);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const { done, failed } = await processBatch(jobs);
      logger.info(`[resume:worker] batch=${jobs.length} done=${done} failed=${failed}`);
    } catch (err) {
      logger.error(`[resume:worker] loop error: ${err.message}`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(pollIntervalMs);
    }
  }
  running = false;
  logger.info('[resume:worker] loop exited');
};

/** Start the drain loop. No-op when the worker or screening is disabled. Idempotent. */
const start = () => {
  if (running) return;
  if (!config.worker.enabled) {
    logger.info('[resume:worker] disabled (RESUME_WORKER_ENABLED=false)');
    return;
  }
  if (!config.enabled) {
    logger.info('[resume:worker] idle — screening not configured (no REZMATCH_API_KEY)');
    return;
  }
  stopping = false;
  loopPromise = runLoop();
};

/** Graceful shutdown: stop claiming, let in-flight jobs finish. */
const stop = async () => {
  stopping = true;
  if (loopPromise) {
    await loopPromise;
    loopPromise = null;
  }
};

module.exports = { start, stop, runLoop, buildJdText };
