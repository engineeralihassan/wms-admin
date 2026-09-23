/**
 * Additive migration for the Sales Opportunity discovery feature.
 *
 * This project uses `sequelize.sync({ force: false })`, which CREATES missing tables
 * but is conservative about altering existing ones. On a fresh database sync already
 * creates `opportunities`; this script guarantees the table (and its unique idempotency
 * index) exist on databases that were synced before the model was added.
 *
 * Run with:  npm run migrate:opportunities
 *
 * Safe to run repeatedly: it syncs ONLY the Opportunity model (creating the table if
 * absent) and adds the composite unique index only when missing.
 */
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({
  path: path.resolve(process.cwd(), `config.${process.env.NODE_ENV || 'DEVELOPMENT'}.env`),
});

const db = require('../models');

const { sequelize, Opportunity } = db;

async function run() {
  try {
    await sequelize.authenticate();

    // Create the table if it doesn't exist (no-op if it already does).
    await Opportunity.sync();
    console.log('✓ opportunities table ensured');

    const qi = sequelize.getQueryInterface();

    // Additive column: salary_display (human-friendly salary text from the source).
    // sync() won't add columns to an existing table, so add it explicitly if missing.
    const table = await qi.describeTable('opportunities').catch(() => ({}));
    if (!table.salary_display) {
      await qi.addColumn('opportunities', 'salary_display', {
        type: sequelize.Sequelize.STRING(120),
        allowNull: true,
      });
      console.log('+ added opportunities.salary_display');
    } else {
      console.log('✓ opportunities.salary_display already present');
    }

    // Ensure the composite unique idempotency index exists.
    const indexes = await qi.showIndex('opportunities').catch(() => []);
    const hasUnique = indexes.some(
      (ix) => ix.unique && (ix.fields || []).map((f) => f.attribute).join(',') ===
        'organization_id,source,external_id'
    );
    if (!hasUnique) {
      await qi.addIndex('opportunities', ['organization_id', 'source', 'external_id'], {
        unique: true,
        name: 'opportunities_org_source_external_uniq',
      });
      console.log('+ added unique (organization_id, source, external_id) index');
    } else {
      console.log('✓ unique idempotency index already present');
    }

    console.log('Opportunities migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('Opportunities migration failed:', err);
    process.exit(1);
  }
}

run();
