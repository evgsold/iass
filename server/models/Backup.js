const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const Backup = sequelize.define('Backup', {
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
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    imageTag: {
        type: DataTypes.STRING,
        allowNull: false
    },
    volumePath: {
        type: DataTypes.STRING,
        allowNull: true
    },
    volumeName: {
        type: DataTypes.STRING,
        allowNull: true
    },
    size: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    status: {
        type: DataTypes.ENUM('creating', 'ready', 'error'),
        defaultValue: 'creating'
    },
    error: {
        type: DataTypes.TEXT,
        allowNull: true
    }
}, {
    tableName: 'Backups',
    timestamps: true
});

module.exports = Backup;