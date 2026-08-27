const Sequelize = require('sequelize');
const dotenv = require('dotenv');
const path = require('path');
const definitions = require('./definitions');

dotenv.config({
  path: path.resolve(process.cwd(), `config.${process.env.NODE_ENV}.env`),
});
const { DB_HOST, DB_USER, DB_PORT, DB_PASSWORD, DB_DATABASE } = process.env;
const useSsl = process.env.DB_SSL === 'true';
const sequelize = new Sequelize(DB_DATABASE, DB_USER, DB_PASSWORD, {
  host: DB_HOST,
  port: DB_PORT,
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
});

const db = definitions(sequelize, Sequelize);

module.exports = db;
