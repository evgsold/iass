const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const ProjectUser = sequelize.define('ProjectUser', {
    projectId: {
        type: DataTypes.UUID,
        primaryKey: true,
        references: {
            model: 'Projects',
            key: 'id'
        }
    },
    userId: {
        type: DataTypes.UUID,
        primaryKey: true,
        references: {
            model: 'Users',
            key: 'id'
        }
    },
    role: {
        type: DataTypes.ENUM('admin', 'editor', 'viewer'),
        defaultValue: 'editor'
    }
});

module.exports = ProjectUser;
