const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const ResourceLog = sequelize.define('ResourceLog', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    vmId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'VMs',
            key: 'id'
        }
    },
    cpuUsage: {
        type: DataTypes.FLOAT,
        defaultValue: 0
    },
    ramUsage: {
        type: DataTypes.FLOAT,
        defaultValue: 0
    },
    timestamp: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
});

module.exports = ResourceLog;
