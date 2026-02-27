const { Project, User, ProjectUser, VM } = require('../models');

class ProjectService {
    async createProject(userId, name, description) {
        const project = await Project.create({ name, description, ownerId: userId });
        await ProjectUser.create({ projectId: project.id, userId, role: 'admin' });
        return project;
    }

    async getProjects(userId) {
        // 1. Находим все записи связи для этого пользователя
        const projectLinks = await ProjectUser.findAll({
            where: { userId },
            attributes: ['projectId']
        });

        // 2. Извлекаем ID проектов
        const projectIds = projectLinks.map(link => link.projectId);

        if (projectIds.length === 0) return [];

        // 3. Получаем сами проекты
        return await Project.findAll({
            where: { id: projectIds },
            include: [
                { model: User, as: 'owner', attributes: ['id', 'name', 'email'] }
            ]
        });
    }

    async getProject(projectId, userId) {
        // 1. Проверяем существование проекта
        const project = await Project.findByPk(projectId, {
            include: [
                { model: User, as: 'owner', attributes: ['id', 'name', 'email'] },
                { model: VM, as: 'vms' }
            ]
        });

        if (!project) throw new Error('Проект не найден');

        // 2. Проверяем доступ через таблицу связи
        const projectUser = await ProjectUser.findOne({
            where: { projectId, userId }
        });

        if (!projectUser) throw new Error('Доступ запрещен');

        // 3. Получаем всех участников проекта
        const projectLinks = await ProjectUser.findAll({
            where: { projectId },
            include: [{
                model: User,
                attributes: ['id', 'name', 'email']
            }]
        });

        // 4. Формируем массив пользователей с ролями (для совместимости)
        project.users = projectLinks.map(link => ({
            ...link.User.dataValues,
            ProjectUser: { role: link.role }
        }));

        return project;
    }

    async addUserToProject(projectId, userId, email, role = 'viewer') {
        // 1. Проверяем существование проекта
        const project = await Project.findByPk(projectId);
        if (!project) throw new Error('Проект не найден');

        // 2. Проверяем права запрашивающего через таблицу связи
        const requester = await ProjectUser.findOne({
            where: { projectId, userId }
        });

        if (!requester || requester.role !== 'admin') {
            throw new Error('Только администратор проекта может добавлять пользователей');
        }

        // 3. Ищем пользователя по email
        const userToAdd = await User.findOne({ where: { email } });
        if (!userToAdd) throw new Error('Пользователь не найден');

        // 4. Проверяем, не состоит ли уже пользователь в проекте
        const existingMember = await ProjectUser.findOne({
            where: { projectId, userId: userToAdd.id }
        });
        if (existingMember) throw new Error('Пользователь уже в проекте');

        // 5. Добавляем пользователя в проект
        await ProjectUser.create({ projectId, userId: userToAdd.id, role });
        return { message: 'Пользователь добавлен' };
    }
}

module.exports = new ProjectService();