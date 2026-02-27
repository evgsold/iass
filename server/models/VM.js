const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const VM = sequelize.define('VM', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    framework: {
        type: DataTypes.STRING,
        allowNull: true
    },
    githubUrl: {
        type: DataTypes.STRING,
        allowNull: true
    },
    type: {
        type: DataTypes.ENUM('app', 'docker', 'k8s'),
        defaultValue: 'app'
    },
    dockerImage: {
        type: DataTypes.STRING,
        allowNull: true
    },
    subdomain: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true
    },
    ram: {
        type: DataTypes.INTEGER,
        defaultValue: 2048
    },
    cpu: {
        type: DataTypes.INTEGER,
        defaultValue: 2
    },
    disk: {
        type: DataTypes.INTEGER,
        defaultValue: 20
    },
    ip: {
        type: DataTypes.STRING
    },
    hostPort: {
        type: DataTypes.INTEGER
    },
    appUrl: {
        type: DataTypes.STRING
    },
    status: {
        type: DataTypes.ENUM('creating', 'running', 'stopped', 'error', 'deploying', 'deployed'),
        defaultValue: 'creating'
    },
    error: {
        type: DataTypes.TEXT
    },
    projectId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'Projects',
            key: 'id'
        }
    }
});

module.exports = VM;
