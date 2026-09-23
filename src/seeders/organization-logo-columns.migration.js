/**
 * Idempotent additive migration for the Organization logo feature.
 *
 * This project uses `sequelize.sync({ force: false })`, which creates missing TABLES
 * but never adds missing COLUMNS to an existing table. The logo feature adds two
 * nullable string columns to `organizations`:
 *   - logo_url          (client-facing delivery URL of the uploaded logo)
 *   - logo_storage_key  (provider object key, for later removal/replacement)
 *
 * Run with:  npm run migrate:org-logo
 *
 * Safe to run repeatedly: each column is added only if it doesn't already exist.
 */
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({
  path: path.resolve(process.cwd(), `config.${process.env.NODE_ENV || 'DEVELOPMENT'}.env`),
});

const db = require('../models');

const { sequelize } = db;

const COLUMNS = ['logo_url', 'logo_storage_key'];

async function ensureColumn(qi, tableName, columnName) {
  const table = await qi.describeTable(tableName);
  if (table[columnName]) {
    console.log(`✓ ${tableName}.${columnName} already exists — skipping`);
    return;
  }
  await qi.addColumn(tableName, columnName, {
    type: sequelize.Sequelize.STRING(1024),
    allowNull: true,
  });
  console.log(`+ Added ${tableName}.${columnName}`);
}

async function run() {
  const qi = sequelize.getQueryInterface();
  try {
    await sequelize.authenticate();
    for (const col of COLUMNS) {
      // eslint-disable-next-line no-await-in-loop
      await ensureColumn(qi, 'organizations', col);
    }
    console.log('Organization logo columns migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('Organization logo columns migration failed:', err);
    process.exit(1);
  }
}

run();
