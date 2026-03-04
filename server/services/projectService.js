const { Project, User, ProjectUser, VM, ProjectInvitation } = require('../models');
const { sendMail } = require('../utils/mailer');
const config = require('../config');
const { v4: uuidv4 } = require('uuid');

class ProjectService {
    getDefaultPermissions(role) {
        switch (role) {
            case 'admin':
                return {
                    canCreateVM: true,
                    canDeleteVM: true,
                    canStartStopVM: true,
                    canManageAccess: true,
                    canViewLogs: true
                };
            case 'editor':
                return {
                    canCreateVM: true,
                    canDeleteVM: false,
                    canStartStopVM: true,
                    canManageAccess: false,
                    canViewLogs: true
                };
            case 'viewer':
                return {
                    canCreateVM: false,
                    canDeleteVM: false,
                    canStartStopVM: false,
                    canManageAccess: false,
                    canViewLogs: true
                };
            default:
                return {
                    canCreateVM: false,
                    canDeleteVM: false,
                    canStartStopVM: false,
                    canManageAccess: false,
                    canViewLogs: true
                };
        }
    }

    async createProject(userId, name, description) {
        const project = await Project.create({ name, description, ownerId: userId });
        await ProjectUser.create({ 
            projectId: project.id, 
            userId, 
            role: 'admin',
            permissions: this.getDefaultPermissions('admin')
        });
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
            ProjectUser: { 
                role: link.role,
                permissions: link.permissions || this.getDefaultPermissions(link.role)
            }
        }));

        return project;
    }

    async inviteUserToProject(projectId, requesterId, email, role = 'viewer') {
        // 1. Проверяем существование проекта
        const project = await Project.findByPk(projectId);
        if (!project) throw new Error('Проект не найден');

        // 2. Проверяем права запрашивающего через таблицу связи
        const requester = await ProjectUser.findOne({
            where: { projectId, userId: requesterId }
        });

        if (!requester || (requester.role !== 'admin' && !requester.permissions?.canManageAccess)) {
            throw new Error('Только администратор проекта может приглашать пользователей');
        }

        // 3. Проверяем, не состоит ли уже пользователь в проекте
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            const existingMember = await ProjectUser.findOne({
                where: { projectId, userId: existingUser.id }
            });
            if (existingMember) throw new Error('Пользователь уже в проекте');
        }

        // 4. Проверяем, нет ли уже активного приглашения
        const existingInvitation = await ProjectInvitation.findOne({
            where: { projectId, email, status: 'pending' }
        });
        if (existingInvitation) throw new Error('Приглашение этому пользователю уже отправлено');

        // 5. Создаем токен приглашения
        const token = uuidv4();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 часа

        await ProjectInvitation.create({
            projectId,
            email,
            role,
            token,
            expiresAt
        });

        // 6. Отправляем email
        const confirmationLink = `${config.FRONTEND_URL}/confirm-invite?token=${token}`;
        const htmlContent = `
            <p>Вы были приглашены в проект <strong>${project.name}</strong> с ролью <strong>${role}</strong>.</p>
            <p>Для подтверждения, пожалуйста, перейдите по ссылке:</p>
            <p><a href="${confirmationLink}">Принять приглашение</a></p>
            <p>Срок действия ссылки истекает через 24 часа.</p>
        `;
        await sendMail(email, `Приглашение в проект ${project.name}`, htmlContent);

        return { message: 'Приглашение отправлено' };
    }

    async confirmProjectInvitation(token) {
        const invitation = await ProjectInvitation.findOne({ where: { token, status: 'pending' } });
        if (!invitation) throw new Error('Приглашение не найдено или недействительно');

        if (new Date() > invitation.expiresAt) {
            invitation.status = 'expired';
            await invitation.save();
            throw new Error('Срок действия приглашения истек');
        }

        // Find or create user. If user doesn't exist, they need to register first.
        let user = await User.findOne({ where: { email: invitation.email } });
        
        if (!user) {
            // User needs to register first. We can return the invitation details
            // so the frontend can redirect them to registration with pre-filled email.
            return { requiresRegistration: true, invitation };
        }

        // Check if user is already a member
        const existingMember = await ProjectUser.findOne({
            where: { projectId: invitation.projectId, userId: user.id }
        });
        if (existingMember) {
            invitation.status = 'accepted';
            await invitation.save();
            return { message: 'Вы уже являетесь участником этого проекта.' };
        }

        await ProjectUser.create({
            projectId: invitation.projectId,
            userId: user.id,
            role: invitation.role,
            permissions: this.getDefaultPermissions(invitation.role)
        });

        invitation.status = 'accepted';
        await invitation.save();

        return { message: 'Вы успешно присоединились к проекту!', project: invitation.projectId };
    }

    async addUserToProject(projectId, userId, email, role = 'viewer') {
        // This function is now deprecated in favor of inviteUserToProject
        throw new Error('Используйте inviteUserToProject для добавления пользователей.');
    }

    async checkAccess(projectId, userId, requiredPermission = null) {
        const member = await ProjectUser.findOne({ where: { projectId, userId } });
        if (!member) throw new Error('Access denied');
        
        // Admin always has access
        if (member.role === 'admin') return true;

        const permissions = member.permissions || this.getDefaultPermissions(member.role);

        if (requiredPermission) {
            if (!permissions || !permissions[requiredPermission]) {
                 throw new Error(`Permission denied: ${requiredPermission} required`);
            }
        }
        return true;
    }

    async updateUserPermissions(projectId, requesterId, targetUserId, permissions) {
        // Check requester rights
        const requester = await ProjectUser.findOne({ where: { projectId, userId: requesterId } });
        if (!requester || (requester.role !== 'admin' && !requester.permissions?.canManageAccess)) {
            throw new Error('Нет прав на управление доступом');
        }

        const targetUser = await ProjectUser.findOne({ where: { projectId, userId: targetUserId } });
        if (!targetUser) throw new Error('Пользователь не найден в проекте');

        // Don't allow changing owner permissions (if needed, but owner is usually admin)
        // For now, assume owner is just an admin who created it.

        await targetUser.update({ permissions });
        return { message: 'Права обновлены', permissions };
    }

    async removeUserFromProject(projectId, requesterId, targetUserId) {
        const requester = await ProjectUser.findOne({ where: { projectId, userId: requesterId } });
        if (!requester || (requester.role !== 'admin' && !requester.permissions?.canManageAccess)) {
            throw new Error('Нет прав на управление доступом');
        }

        const targetUser = await ProjectUser.findOne({ where: { projectId, userId: targetUserId } });
        if (!targetUser) throw new Error('Пользователь не найден в проекте');

        await targetUser.destroy();
        return { message: 'Пользователь удален из проекта' };
    }
}

module.exports = new ProjectService();