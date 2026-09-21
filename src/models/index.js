const Sequelize = require('sequelize');
const dotenv = require('dotenv');
const path = require('path');
const definitions = require('./definitions');

dotenv.config({
  path: path.resolve(process.cwd(), `config.${process.env.NODE_ENV}.env`),
});
const { DB_HOST, DB_USER, DB_PORT, DB_PASSWORD, DB_DATABASE } = process.env;
const databaseUrl = (process.env.DB_URL || process.env.DATABASE_URL || '').trim();
const sslModeRequired = /(?:[?&])sslmode=require(?:&|$)/i.test(databaseUrl);
const useSsl = process.env.DB_SSL === 'true' || sslModeRequired;
const sequelizeOptions = {
  dialect: 'postgres',
  dialectOptions: useSsl
    ? { ssl: { require: true, rejectUnauthorized: false } }
    : {},
  pool: {
    max: 5,
    min: 0,
    acquire: 180000000,
    idle: 10000,
  },
  logging: false,
};

// Prefer a managed PostgreSQL URL (for example Neon) when configured. The
// split variables remain as a fallback for local PostgreSQL development.
const sequelize = databaseUrl
  ? new Sequelize(databaseUrl, sequelizeOptions)
  : new Sequelize(DB_DATABASE, DB_USER, DB_PASSWORD, {
      ...sequelizeOptions,
      host: DB_HOST,
      port: DB_PORT,
    });

const db = definitions(sequelize, Sequelize);

module.exports = db;
