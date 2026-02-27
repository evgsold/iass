const { sequelize, connectDB } = require('../db');
const User = require('./User');
const Project = require('./Project');
const ProjectUser = require('./ProjectUser');
const VM = require('./VM');
const ResourceLog = require('./ResourceLog');
const Backup = require('./Backup');

// Relations
User.hasMany(Project, { foreignKey: 'ownerId', as: 'ownedProjects' });
Project.belongsTo(User, { foreignKey: 'ownerId', as: 'owner' });

User.belongsToMany(Project, { through: ProjectUser, as: 'projects' });
Project.belongsToMany(User, { through: ProjectUser, as: 'users' });

// Explicit associations for the through table to allow direct querying
ProjectUser.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(ProjectUser, { foreignKey: 'userId' });

ProjectUser.belongsTo(Project, { foreignKey: 'projectId' });
Project.hasMany(ProjectUser, { foreignKey: 'projectId' });

Project.hasMany(VM, { foreignKey: 'projectId', as: 'vms' });
VM.belongsTo(Project, { foreignKey: 'projectId', as: 'project' });

VM.hasMany(ResourceLog, { foreignKey: 'vmId', as: 'resourceLogs' });
ResourceLog.belongsTo(VM, { foreignKey: 'vmId', as: 'vm' });

VM.hasMany(Backup, { foreignKey: 'vmId', as: 'backups' });
Backup.belongsTo(VM, { foreignKey: 'vmId', as: 'vm' });

module.exports = {
    sequelize,
    connectDB,
    User,
    Project,
    ProjectUser,
    VM,
    ResourceLog,
    Backup
};
