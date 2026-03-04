const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const ProjectInvitation = sequelize.define('ProjectInvitation', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    projectId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'Projects',
            key: 'id'
        }
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            isEmail: true
        }
    },
    role: {
        type: DataTypes.ENUM('admin', 'editor', 'viewer'),
        defaultValue: 'viewer'
    },
    token: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    expiresAt: {
        type: DataTypes.DATE,
        allowNull: false
    },
    status: {
        type: DataTypes.ENUM('pending', 'accepted', 'declined', 'expired'),
        defaultValue: 'pending'
    }
});

module.exports = ProjectInvitation;
