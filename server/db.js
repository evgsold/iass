const { Sequelize, Op } = require('sequelize');
const config = require('./config');
const logger = require('./utils/logger');

const sequelize = new Sequelize(config.DB_NAME, config.DB_USER, config.DB_PASSWORD, {
    host: config.DB_HOST,
    port: config.DB_PORT,
    dialect: 'postgres',
    logging: (msg) => logger.info(msg),
    pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000
    }
});

const connectDB = async () => {
    try {
        await sequelize.authenticate();
        logger.success('PostgreSQL connected successfully.');
        await sequelize.sync({ alter: true }); // Sync models
        logger.success('Database models synchronized.');
    } catch (error) {
        logger.error('Unable to connect to the database:', error);
        process.exit(1);
    }
};

module.exports = { sequelize, connectDB, Op };
