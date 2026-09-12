/**
 * Idempotent additive migration for the User Profile feature.
 *
 * This project uses `sequelize.sync({ force: false })`, which creates missing TABLES
 * but never adds missing COLUMNS to an existing table. The profile feature adds two
 * JSONB columns to `user_profiles`:
 *   - bank_details       (structured bank info block)
 *   - verified_sections  (section lock markers — Option A locking)
 *
 * Run with:  npm run migrate:profile
 *
 * Safe to run repeatedly: each column is added only if it doesn't already exist, and
 * back-filled to an empty object so existing rows satisfy the NOT NULL default.
 */
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({
  path: path.resolve(process.cwd(), `config.${process.env.NODE_ENV || 'DEVELOPMENT'}.env`),
});

const db = require('../models');

const { sequelize } = db;

const COLUMNS = [
  { name: 'bank_details', comment: 'Structured bank details JSONB block.' },
  { name: 'verified_sections', comment: 'Section lock markers (Option A locking).' },
];

async function ensureColumn(qi, tableName, columnName) {
  const table = await qi.describeTable(tableName);
  if (table[columnName]) {
    console.log(`✓ ${tableName}.${columnName} already exists — skipping`);
    return;
  }
  await qi.addColumn(tableName, columnName, {
    type: sequelize.Sequelize.JSONB,
    allowNull: false,
    defaultValue: {},
  });
  console.log(`+ Added ${tableName}.${columnName}`);
}

async function run() {
  const qi = sequelize.getQueryInterface();
  try {
    await sequelize.authenticate();
    for (const col of COLUMNS) {
      // eslint-disable-next-line no-await-in-loop
      await ensureColumn(qi, 'user_profiles', col.name);
    }
    console.log('Profile columns migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('Profile columns migration failed:', err);
    process.exit(1);
  }
}

run();
