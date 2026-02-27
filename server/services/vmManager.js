// server/services/vmManager.js
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const config = require('../config');
const logger = require('../utils/logger');
const hypervisor = require('./hypervisor');
const cloudinit = require('./cloudinit');
const ssh = require('./ssh');
const { VM, Project, ResourceLog, Backup } = require('../models');

const { exec } = require('child_process');

class VMManager {
    /**
     * Создает новую виртуальную машину
     */
    async createVM(vmConfig, projectId) {
        const project = await Project.findByPk(projectId);
        if (!project) {
            throw new Error('Проект не найден');
        }

        // Проверка квот (без фильтрации по статусу deleted)
        const projectVMsCount = await VM.count({ where: { projectId } });
        
        const maxVMs = config.MAX_VMS_PER_PROJECT || 5;
        if (projectVMsCount >= maxVMs) {
            throw new Error(`Превышен лимит ВМ в проекте (максимум ${maxVMs})`);
        }

        const vmId = uuidv4();
        const sanitizedName = (vmConfig.name || '').replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
        
        // Generate subdomain
        let subdomain = sanitizedName;
        let counter = 1;
        while (await VM.findOne({ where: { subdomain } })) {
            subdomain = `${sanitizedName}-${counter}`;
            counter++;
        }

        const vmName = `nextjs-${sanitizedName ? sanitizedName + '-' : ''}${vmId.substring(0, 8)}`;
        
        // Поиск следующего доступного порта
        const lastVM = await VM.findOne({ 
            order: [['hostPort', 'DESC']],
            where: { projectId }
        });
        const hostPort = lastVM ? lastVM.hostPort + 1 : (config.BASE_HOST_PORT || 8000);

        const vm = await VM.create({
            id: vmId,
            projectId,
            name: vmName,
            subdomain: subdomain,
            type: vmConfig.type || 'app',
            framework: vmConfig.framework,
            githubUrl: vmConfig.githubUrl,
            dockerImage: vmConfig.dockerImage,
            ram: vmConfig.ram || config.DEFAULT_RAM || 2048,
            cpu: vmConfig.cpu || config.DEFAULT_CPU || 2,
            disk: vmConfig.disk || config.DEFAULT_DISK || 20,
            hostPort,
            status: 'creating',
            error: null
        });

        // Register domain with Greenlock
        try {
            const domain = `${subdomain}.${config.BASE_DOMAIN}`;
            logger.info(`Registering SSL for ${domain}...`);
            exec(`npx greenlock add --subject ${domain} --altnames ${domain}`, { cwd: path.join(__dirname, '..') }, (err, stdout, stderr) => {
                if (err) {
                    logger.warn(`Failed to register SSL for ${domain}: ${stderr}`);
                } else {
                    logger.success(`SSL registered for ${domain}`);
                }
            });
        } catch (e) {
            logger.error('Error registering SSL:', e);
        }

        // Асинхронная подготовка ВМ
        this.provisionVM(vm).catch(err => {
            vm.update({ 
                status: 'error', 
                error: err.message 
            }).catch(updateErr => {
                logger.error('Ошибка обновления статуса ВМ', updateErr);
            });
            logger.error('Ошибка создания ВМ', err);
        });

        return vm;
    }

    /**
     * Подготовка и настройка ВМ
     */
    async provisionVM(vm) {
        try {
            logger.info(`Начало подготовки ВМ: ${vm.name}`);

            // CloudInit нужен только для Libvirt
            let cloudInitIso = null;
            if (config.MODE !== 'docker') {
                await cloudinit.downloadCloudImage();
                
                const sshKeyPath = config.SSH_KEY_PATH || '/root/.ssh/id_rsa';
                
                if (!fs.existsSync(sshKeyPath + '.pub')) {
                    throw new Error(`SSH ключ не найден: ${sshKeyPath}.pub. Запустите: ssh-keygen -t rsa`);
                }
                
                const sshPublicKey = fs.readFileSync(sshKeyPath + '.pub', 'utf8').trim();
                cloudInitIso = await cloudinit.createISO(vm.name, vm.id, sshPublicKey);
            }

            // Создание диска
            const diskPath = await hypervisor.createDisk(vm.name, vm.disk);

            // Создание и запуск ВМ
            await hypervisor.createVM({
                name: vm.name,
                type: vm.type,
                dockerImage: vm.dockerImage,
                framework: vm.framework,
                ram: vm.ram,
                cpu: vm.cpu,
                diskPath,
                cloudInitIso,
                network: config.VM_NETWORK || 'default',
                hostPort: vm.hostPort,
            });

            await vm.update({ status: 'running' });
            logger.info(`ВМ ${vm.name} запущена, ожидание готовности...`);

            // Ожидание запуска ВМ
            await this.waitForVM(vm.name);
            
            // Получение IP адреса
            const ip = await hypervisor.getVMIP(vm.name);
            await vm.update({ 
                ip, 
                status: 'deploying'
            });

            // Деплой приложения
            let deployResult = { success: true };
            
            if (config.MODE === 'docker') {
                // В тестовом режиме эмулируем деплой
                if (vm.type === 'app') {
                    logger.info(`Test mode: эмуляция деплоя для ${vm.name}`);
                    await this.deployViaDocker(vm);
                } else {
                    logger.info(`Container/K8s mode: пропуск деплоя приложения для ${vm.name}`);
                }
            } else {
                // Продакшен деплой через SSH
                if (ip) {
                    if (vm.githubUrl) {
                        deployResult = await ssh.deployApp(ip, vm.githubUrl, vm.name);
                    } else {
                        logger.info('GitHub URL не указан, пропуск деплоя приложения');
                    }
                } else {
                    throw new Error('Не удалось получить IP адрес ВМ');
                }
            }
            
            if (deployResult.success) {
                await vm.update({ 
                    status: 'deployed', 
                    appUrl: `https://${vm.subdomain}.${config.BASE_DOMAIN}`
                });
                logger.success(`ВМ ${vm.name} полностью готова.`);
            } else {
                await vm.update({ 
                    status: 'error', 
                    error: deployResult.error || 'Ошибка деплоя приложения'
                });
                throw new Error(deployResult.error || 'Ошибка деплоя приложения');
            }

        } catch (error) {
            logger.error(`Ошибка подготовки ВМ ${vm.name}:`, error);
            await vm.update({ status: 'error', error: error.message });
            throw error;
        }
    }

    /**
     * Запуск приложения внутри контейнера
     */
    async startAppInDocker(vm) {
        const vmName = vm.name;
        logger.info(`Запуск приложения (${vm.framework}) в контейнере ${vmName}...`);
        
        try {
            let startCmd = '';
            
            if (vm.framework === 'node') {
                const check = await hypervisor.execCommand(vmName, '[ -f package.json ] && echo "yes" || echo "no"');
                if (check.trim() === 'yes') {
                    startCmd = 'nohup env PORT=3000 HOST=0.0.0.0 npm start > /app/app.log 2>&1 &';
                }
            } else if (vm.framework === 'python') {
                const check = await hypervisor.execCommand(vmName, '[ -f app.py ] && echo "yes" || echo "no"');
                if (check.trim() === 'yes') {
                    startCmd = 'nohup env PORT=3000 HOST=0.0.0.0 python app.py > /app/app.log 2>&1 &';
                } else {
                    // Try flask
                    const checkFlask = await hypervisor.execCommand(vmName, '[ -f wsgi.py ] || [ -f main.py ] && echo "yes" || echo "no"');
                    if (checkFlask.trim() === 'yes') {
                         startCmd = 'nohup env PORT=3000 HOST=0.0.0.0 python main.py > /app/app.log 2>&1 &';
                    }
                }
            } else if (vm.framework === 'go') {
                const check = await hypervisor.execCommand(vmName, '[ -f main.go ] && echo "yes" || echo "no"');
                if (check.trim() === 'yes') {
                    startCmd = 'nohup env PORT=3000 HOST=0.0.0.0 go run main.go > /app/app.log 2>&1 &';
                }
            }

            if (startCmd) {
                await hypervisor.execCommand(vmName, startCmd);
                logger.success(`Приложение в ${vmName} запущено`);
            } else {
                logger.warn(`Не найден файл запуска для ${vm.framework} в ${vmName}`);
            }
        } catch (e) {
            logger.error(`Ошибка запуска приложения в ${vmName}:`, e);
        }
    }

    /**
     * Деплой через Docker (тестовый режим)
     */
    async deployViaDocker(vm) {
        try {
            logger.info(`Начало деплоя в Docker контейнере ${vm.name}`);
            
            // 1. Подготовка окружения
            logger.info('Подготовка окружения...');
            // Установка git если его нет (для node:18-slim может потребоваться)
            try {
                await hypervisor.execCommand(vm.name, 'which git || (apt-get update && apt-get install -y git)');
            } catch (e) {
                logger.warn('Ошибка установки git (возможно уже установлен или нет прав):', e.message);
            }

            // 2. Клонирование репозитория
            if (vm.githubUrl) {
                logger.info('Клонирование репозитория...');
                // Очистка директории перед клонированием (на всякий случай)
                await hypervisor.execCommand(vm.name, 'rm -rf /app/* /app/.* 2>/dev/null || true');
                await hypervisor.execCommand(vm.name, `git clone ${vm.githubUrl} .`);
                
            // 2. Установка зависимостей и сборка
            logger.info('Установка зависимостей и сборка...');
            
            if (vm.framework === 'node') {
                await hypervisor.execCommand(vm.name, 'npm install');
                try {
                    await hypervisor.execCommand(vm.name, 'npm run build');
                } catch (e) {
                    logger.warn('Сборка не удалась или отсутствует скрипт build (это нормально)');
                }
            } else if (vm.framework === 'python') {
                await hypervisor.execCommand(vm.name, 'pip install -r requirements.txt || true');
            } else if (vm.framework === 'go') {
                await hypervisor.execCommand(vm.name, 'go mod download || true');
                await hypervisor.execCommand(vm.name, 'go build -o app || true');
            }
            
            // 4. Запуск приложения
            await this.startAppInDocker(vm);
            } else {
                logger.info('GitHub URL не указан, пропуск деплоя приложения');
            }
            
            // Даем время на запуск
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            logger.info(`Деплой в Docker контейнере ${vm.name} завершен`);
            return { success: true };
        } catch (error) {
            logger.error('Ошибка деплоя в Docker:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Ожидание запуска ВМ
     */
    async waitForVM(vmName, timeout = 120000) {
        const startTime = Date.now();
        const checkInterval = 5000;
        
        logger.info(`Ожидание запуска ВМ ${vmName}...`);
        
        while (Date.now() - startTime < timeout) {
            const status = await hypervisor.getVMStatus(vmName);
            
            if (status === 'running') {
                await new Promise(r => setTimeout(r, 30000));
                logger.success(`ВМ ${vmName} запущена и готова`);
                return true;
            }
            
            if (status === 'not_found' || status === 'error') {
                throw new Error(`ВМ ${vmName} не найдена или в ошибке`);
            }
            
            await new Promise(r => setTimeout(r, checkInterval));
        }
        
        throw new Error(`Таймаут ожидания ВМ ${vmName} (${timeout}ms)`);
    }

    /**
     * Получить все ВМ
     */
    async getAllVMs(projectId = null) {
        const where = {};
        if (projectId) {
            where.projectId = projectId;
        }
        // Без фильтрации по статусу deleted (нет в ENUM)
        return await VM.findAll({ 
            where,
            order: [['createdAt', 'DESC']]
        });
    }

    /**
     * Получить ВМ по ID
     */
    async getVM(id, projectId = null) {
        const where = { id };
        if (projectId) {
            where.projectId = projectId;
        }
        // Без фильтрации по статусу deleted (нет в ENUM)
        return await VM.findOne({ where });
    }

    /**
     * Удалить ВМ (Hard Delete)
     */
    async deleteVM(id, projectId = null) {
        const vm = await this.getVM(id, projectId);
        if (!vm) {
            throw new Error('ВМ не найдена или доступ запрещен');
        }

        logger.info(`Удаление ВМ: ${vm.name}`);

        try {
            await hypervisor.deleteVM(vm.name);
        } catch (e) {
            logger.warn(`Ошибка удаления VM в гипервизоре: ${e.message}`);
        }
        
        // Отключение SSH сессии
        if (vm.ip && config.MODE !== 'docker') {
            try {
                ssh.disconnect(vm.ip);
            } catch (e) {
                logger.warn(`Ошибка отключения SSH: ${e.message}`);
            }
        }
        
        // Полное удаление из БД (hard delete)
        await vm.destroy();
        
        logger.success(`ВМ ${vm.name} удалена`);
        return true;
    }

    /**
     * Остановить ВМ
     */
    async stopVM(id, projectId = null) {
        const vm = await this.getVM(id, projectId);
        if (!vm) {
            throw new Error('ВМ не найдена или доступ запрещен');
        }

        if (vm.status === 'stopped') {
            throw new Error('ВМ уже остановлена');
        }

        await hypervisor.stopVM(vm.name);
        await vm.update({ status: 'stopped' });
        
        logger.info(`ВМ ${vm.name} остановлена`);
        return true;
    }

    /**
     * Запустить ВМ
     */
    async startVM(id, projectId = null) {
        const vm = await this.getVM(id, projectId);
        if (!vm) {
            throw new Error('ВМ не найдена или доступ запрещен');
        }

        if (vm.status === 'running' || vm.status === 'deployed') {
            throw new Error('ВМ уже запущена');
        }

        if (config.MODE === 'docker') {
            await hypervisor.startVM(vm.name);
        } else {
            await hypervisor.runCommand(`start ${vm.name}`);
        }
        
        await this.waitForVM(vm.name, 60000);
        
        if (config.MODE === 'docker') {
            if (vm.type === 'app') {
                await this.startAppInDocker(vm);
            }
        }

        await vm.update({ status: 'running' });
        
        logger.info(`ВМ ${vm.name} запущена`);
        return true;
    }

    /**
     * Перезапустить ВМ
     */
    async restartVM(id, projectId = null) {
        const vm = await this.getVM(id, projectId);
        if (!vm) {
            throw new Error('ВМ не найдена или доступ запрещен');
        }

        logger.info(`Перезапуск ВМ: ${vm.name}`);
        
        try {
            await this.stopVM(id, projectId);
        } catch (e) {
            logger.warn(`Ошибка остановки ВМ: ${e.message}`);
        }
        
        await new Promise(r => setTimeout(r, 5000));
        await this.startVM(id, projectId);
        
        return true;
    }

    /**
     * Получить статус ВМ из гипервизора
     */
    async getVMRealStatus(id, projectId = null) {
        const vm = await this.getVM(id, projectId);
        if (!vm) {
            throw new Error('ВМ не найдена или доступ запрещен');
        }

        const realStatus = await hypervisor.getVMStatus(vm.name);
        const ip = await hypervisor.getVMIP(vm.name);
        
        return {
            id: vm.id,
            name: vm.name,
            dbStatus: vm.status,
            realStatus,
            ip,
            hostPort: vm.hostPort,
            appUrl: vm.appUrl
        };
    }

    /**
     * Логирование использования ресурсов
     */
    async logResourceUsage(vmId, cpuUsage, ramUsage) {
        return await ResourceLog.create({
            vmId,
            cpuUsage,
            ramUsage,
            timestamp: new Date()
        });
    }

    /**
     * Получить статистику использования ресурсов ВМ
     */
    async getVMResourceStats(vmId, hours = 24) {
        // Если запрашивается статистика "прямо сейчас" (например, hours=0),
        // можно попробовать вернуть текущие данные из Docker
        if (hours === 0 && config.MODE === 'docker') {
             const vm = await this.getVM(vmId);
             if (vm) {
                 const stats = await hypervisor.getStats(vm.name);
                 if (stats) {
                     return {
                         currentCpu: stats.cpu,
                         currentRam: stats.ram
                     };
                 }
             }
        }

        const since = new Date(Date.now() - hours * 60 * 60 * 1000);
        
        const logs = await ResourceLog.findAll({
            where: {
                vmId,
                createdAt: { [Op.gte]: since }
            },
            order: [['createdAt', 'ASC']]
        });

        if (logs.length === 0) {
            return { avgCpu: 0, avgRam: 0, maxCpu: 0, maxRam: 0, samples: 0 };
        }

        const cpuValues = logs.map(l => l.cpuUsage);
        const ramValues = logs.map(l => l.ramUsage);

        return {
            avgCpu: cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length,
            avgRam: ramValues.reduce((a, b) => a + b, 0) / ramValues.length,
            maxCpu: Math.max(...cpuValues),
            maxRam: Math.max(...ramValues),
            samples: logs.length
        };
    }

    /**
     * Создать бекап ВМ
     */
    async createBackup(vmId, name, projectId = null) {
        const vm = await this.getVM(vmId, projectId);
        if (!vm) {
            throw new Error('ВМ не найдена или доступ запрещен');
        }

        if (config.MODE !== 'docker') {
            throw new Error('Бекапы поддерживаются только в режиме Docker');
        }

        const backupName = `backup-${vm.name}-${Date.now()}`;
        const backupDir = path.join(config.VM_STORAGE_DIR || '/tmp/vms', '../backups');
        
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const volumeArchiveName = `${backupName}.tar.gz`;
        const volumePath = path.join(backupDir, volumeArchiveName);
        const diskPath = path.join(config.VM_STORAGE_DIR || '/tmp/vms', vm.name);
        
        const backup = await Backup.create({
            vmId: vm.id,
            name: name || `Backup ${new Date().toLocaleString()}`,
            imageTag: backupName,
            volumePath: volumePath,
            status: 'creating'
        });

        try {
            // 1. Create Docker Image Backup
            await hypervisor.createBackup(vm.name, backupName);
            
            // 2. Create Volume Backup (tar.gz)
            if (fs.existsSync(diskPath)) {
                logger.info(`Creating volume backup for ${vm.name}...`);
                await new Promise((resolve, reject) => {
                    exec(`tar -czf "${volumePath}" -C "${diskPath}" .`, (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                logger.success(`Volume backup created: ${volumePath}`);
            }

            await backup.update({ status: 'ready' });
            return backup;
        } catch (e) {
            await backup.update({ status: 'error' });
            logger.error(`Backup failed: ${e.message}`);
            throw e;
        }
    }

    /**
     * Получить список бекапов
     */
    async getBackups(vmId, projectId = null) {
        const vm = await this.getVM(vmId, projectId);
        if (!vm) {
            throw new Error('ВМ не найдена или доступ запрещен');
        }

        return await Backup.findAll({
            where: { vmId },
            order: [['createdAt', 'DESC']]
        });
    }

    /**
     * Восстановить из бекапа
     */
    async restoreBackup(vmId, backupId, projectId = null) {
        const vm = await this.getVM(vmId, projectId);
        if (!vm) throw new Error('ВМ не найдена');

        const backup = await Backup.findByPk(backupId);
        if (!backup || backup.vmId !== vmId) throw new Error('Бекап не найден');

        if (config.MODE !== 'docker') throw new Error('Только Docker режим');

        logger.info(`Восстановление ВМ ${vm.name} из бекапа ${backup.name}`);

        // 1. Stop VM
        try {
            await this.stopVM(vmId, projectId);
        } catch (e) {
            // Ignore if already stopped
        }

        // 2. Delete current container (keep volume logic handled below)
        try {
            await hypervisor.ensureConnection();
            const container = hypervisor.docker.getContainer(vm.name);
            await container.remove({ force: true });
        } catch (e) {
            if (e.statusCode !== 404 && !e.message.includes('No such container')) {
                logger.warn(`Ошибка при удалении контейнера для восстановления: ${e.message}`);
            }
        }

        const diskPath = path.join(config.VM_STORAGE_DIR || '/tmp/vms', vm.name);

        // 3. Restore Volume Data
        if (backup.volumePath && fs.existsSync(backup.volumePath)) {
            logger.info(`Restoring volume data from ${backup.volumePath}...`);
            
            // Clean current disk
            if (fs.existsSync(diskPath)) {
                fs.rmSync(diskPath, { recursive: true, force: true });
                fs.mkdirSync(diskPath, { recursive: true });
            } else {
                fs.mkdirSync(diskPath, { recursive: true });
            }

            // Extract archive
            await new Promise((resolve, reject) => {
                exec(`tar -xzf "${backup.volumePath}" -C "${diskPath}"`, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            logger.success(`Volume data restored.`);
        }

        // 4. Update VM config to use backup image
        await vm.update({ dockerImage: backup.imageTag, type: 'docker' });

        // 5. Recreate VM
        await hypervisor.createVM({
            name: vm.name,
            type: 'docker', // Treat as generic docker container now since we use custom image
            dockerImage: backup.imageTag,
            framework: vm.framework,
            ram: vm.ram,
            cpu: vm.cpu,
            diskPath,
            hostPort: vm.hostPort,
            network: config.VM_NETWORK || 'default'
        });

        await vm.update({ status: 'running' });
        return true;
    }

    /**
     * Изменить ресурсы ВМ
     */
    async resizeVM(vmId, ram, cpu, projectId = null) {
        const vm = await this.getVM(vmId, projectId);
        if (!vm) throw new Error('ВМ не найдена');

        logger.info(`Изменение ресурсов ВМ ${vm.name}: RAM ${ram}MB, CPU ${cpu}`);

        // Update DB
        await vm.update({ ram, cpu });

        if (config.MODE === 'docker') {
            // Try dynamic update
            try {
                await hypervisor.updateContainerResources(vm.name, ram, cpu);
            } catch (e) {
                logger.warn(`Не удалось обновить ресурсы на лету, требуется перезагрузка: ${e.message}`);
                // Optional: Force restart if dynamic update fails?
                // For now, just warn.
            }
        }
        
        return vm;
    }

    /**
     * Проверить подключение к гипервизору
     */
    async checkHypervisorConnection() {
        return await hypervisor.checkConnection();
    }

    /**
     * Получить логи ВМ
     */
    async getLogs(id, projectId = null) {
        const vm = await this.getVM(id, projectId);
        if (!vm) {
            throw new Error('ВМ не найдена или доступ запрещен');
        }

        if (config.MODE === 'docker') {
            return await hypervisor.getLogs(vm.name);
        } else {
            if (!vm.ip) return 'IP не получен';
            return await ssh.getLogs(vm.ip, vm.name);
        }
    }

    /**
     * Получить информацию о режиме работы
     */
    getModeInfo() {
        return {
            mode: config.MODE,
            isDocker: config.MODE === 'docker',
            isLibvirt: config.MODE !== 'docker'
        };
    }
}

module.exports = new VMManager();