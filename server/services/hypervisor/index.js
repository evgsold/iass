// server/services/hypervisor/index.js
const config = require('../../config');
const logger = require('../../utils/logger');

let instance = null;

if (config.MODE === 'docker') {
    logger.info('Инициализация гипервизора: Docker (Test Mode)');
    instance = require('./docker');
} else {
    logger.info('Инициализация гипервизора: Libvirt (Production)');
    instance = require('./libvirt');
}

module.exports = instance;