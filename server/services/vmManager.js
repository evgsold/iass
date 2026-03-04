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
const { exec, execSync } = require('child_process');
const { registerDomainSSL } = require('../utils/ssl-manager');

class VMManager {
    // --- WireGuard Helpers ---
    async _generateWireGuardKeys() {
        try {
            const privateKey = execSync('wg genkey').toString().trim();
            const publicKey = execSync(`echo "${privateKey}" | wg pubkey`).toString().trim();
            return { privateKey, publicKey };
        } catch (e) {
            logger.warn('WireGuard tools not found, skipping WG setup:', e.message);
            return null;
        }
    }

    async _assignInternalIp(projectId) {
        // Simple strategy: 10.10.{project_hash}.{vm_count + 2}
        // project_hash = last byte of UUID or similar
        const project = await Project.findByPk(projectId);
        if (!project) return null;

        // Generate a deterministic subnet octet from project ID
        const octet = parseInt(projectId.split('-').pop(), 16) % 254 + 1; 
        
        // Find existing IPs in this subnet
        const vms = await VM.findAll({ where: { projectId } });
        const usedIps = vms.map(v => v.internalIp).filter(Boolean);
        
        // Find first free IP starting from .2
        for (let i = 2; i < 255; i++) {
            const ip = `10.10.${octet}.${i}`;
            if (!usedIps.includes(ip)) {
                return ip;
            }
        }
        return null; // Subnet full
    }

    async _getWireGuardPeers(projectId, currentVmId) {
        const peers = await VM.findAll({
            where: {
                projectId,
                id: { [Op.ne]: currentVmId },
                wgPublicKey: { [Op.not]: null },
                internalIp: { [Op.not]: null },
                ip: { [Op.not]: null } // Must have external IP for endpoint
            }
        });

        return peers.map(p => ({
            publicKey: p.wgPublicKey,
            allowedIps: `${p.internalIp}/32`,
            endpoint: `${p.ip}:51820` // Standard WG port
        }));
    }

    async _updateExistingPeers(newVm) {
        if (!newVm.wgPublicKey || !newVm.internalIp || !newVm.ip) return;

        const peers = await VM.findAll({
            where: {
                projectId: newVm.projectId,
                id: { [Op.ne]: newVm.id },
                wgPublicKey: { [Op.not]: null },
                status: { [Op.or]: ['running', 'deployed'] }
            }
        });

        for (const peer of peers) {
            try {
                logger.info(`Updating WireGuard peer on ${peer.name}...`);
                // Command to add peer
                const cmd = `wg set wg0 peer ${newVm.wgPublicKey} allowed-ips ${newVm.internalIp}/32 endpoint ${newVm.ip}:51820 persistent-keepalive 25`;
                
                // Execute on peer VM
                await hypervisor.execCommand(peer.name, cmd);
                
                // Save config if possible to persist across reboots
                // If SaveConfig=true is set, it might save on shutdown, but explicit save is safer if supported
                await hypervisor.execCommand(peer.name, 'wg-quick save wg0 || true');
                
            } catch (e) {
                logger.warn(`Failed to update WireGuard peer on ${peer.name}: ${e.message}`);
            }
        }
    }
    // -------------------------

    async createVM(vmConfig, projectId) {
        const project = await Project.findByPk(projectId);
        if (!project) {
            throw new Error('Проект не найден');
        }

        const projectVMsCount = await VM.count({ where: { projectId } });
        
        const maxVMs = config.MAX_VMS_PER_PROJECT || 5;
        if (projectVMsCount >= maxVMs) {
            throw new Error(`Превышен лимит ВМ в проекте (максимум ${maxVMs})`);
        }

        const vmId = uuidv4();
        const sanitizedName = (vmConfig.name || '').replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
        
        let subdomain = sanitizedName;
        let counter = 1;
        while (await VM.findOne({ where: { subdomain } })) {
            subdomain = `${sanitizedName}-${counter}`;
            counter++;
        }

        const vmName = `app-${sanitizedName ? sanitizedName + '-' : ''}${vmId.substring(0, 8)}`;
        
        const lastVM = await VM.findOne({ 
            order: [['hostPort', 'DESC']],
            where: { projectId }
        });
        const hostPort = lastVM ? lastVM.hostPort + 1 : (config.BASE_HOST_PORT || 8000);

        // --- WireGuard Setup ---
        const wgKeys = await this._generateWireGuardKeys();
        let internalIp = null;
        if (wgKeys) {
            internalIp = await this._assignInternalIp(projectId);
            if (!internalIp) {
                logger.error('Не удалось назначить внутренний IP для WireGuard');
                // Продолжаем без WG, или можно выбросить ошибку
            }
        }
        // -----------------------

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
            internalIp: internalIp, // Сохраняем внутренний IP
            wgPrivateKey: wgKeys ? wgKeys.privateKey : null,
            wgPublicKey: wgKeys ? wgKeys.publicKey : null,
            status: 'creating',
            error: null
        });

        const domain = `${subdomain}.${config.BASE_DOMAIN}`;
        try {
            logger.info(`Registering SSL for ${domain}...`);
            
            // 🔥 Ждём завершения регистрации SSL перед продолжением
            await registerDomainSSL(domain);
            logger.success(`SSL ready for ${domain}`);
            
        } catch (sslError) {
            logger.error(`SSL registration failed for ${domain}:`, sslError);
            // Опционально: откатить статус VM или пометить как 'ssl_pending'
            await vm.update({ status: 'error', error: sslError.message });
            throw new Error(`Не удалось настроить HTTPS: ${sslError.message}`);
        }

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

    async provisionVM(vm) {
        try {
            logger.info(`Начало подготовки ВМ: ${vm.name}`);

            let cloudInitIso = null;
            if (config.MODE !== 'docker') {
                await cloudinit.downloadCloudImage();
                
                const sshKeyPath = config.SSH_KEY_PATH || '/root/.ssh/id_rsa';
                
                if (!fs.existsSync(sshKeyPath + '.pub')) {
                    throw new Error(`SSH ключ не найден: ${sshKeyPath}.pub`);
                }
                
                const sshPublicKey = fs.readFileSync(sshKeyPath + '.pub', 'utf8').trim();
                
                // Get peers for WireGuard
                const wgPeers = vm.wgPublicKey ? await this._getWireGuardPeers(vm.projectId, vm.id) : [];
                
                cloudInitIso = await cloudinit.createISO({
                    name: vm.name,
                    id: vm.id,
                    sshPublicKey,
                    type: vm.type,
                    framework: vm.framework,
                    dockerImage: vm.dockerImage,
                    hostPort: vm.hostPort,
                    cmd: initialCmd,
                    // Pass WG config
                    wgPrivateKey: vm.wgPrivateKey,
                    wgInternalIp: vm.internalIp,
                    wgPeers
                });
            }

            const diskPath = await hypervisor.createDisk(vm.name, vm.disk);
            logger.info(`Том ВМ создан: ${diskPath}`);

            const initialCmd = config.MODE === 'docker' ? ['sh', '-c', 'while :; do sleep 1; done'] : undefined;

            await hypervisor.createVM({
                name: vm.name,
                type: vm.type,
                dockerImage: vm.dockerImage,
                framework: vm.framework,
                ram: vm.ram,
                cpu: vm.cpu,
                diskPath,
                cloudInitIso,
                network: config.VM_NETWORK || 'app-network',
                hostPort: vm.hostPort,
                cmd: initialCmd
            });

            await vm.update({ status: 'running' });
            logger.info(`ВМ ${vm.name} запущена, ожидание готовности...`);

            await this.waitForVM(vm.name);
            
            const ip = await hypervisor.getVMIP(vm.name);
            await vm.update({ 
                ip, 
                status: 'deploying'
            });

            // Update existing peers with new VM info
            if (vm.wgPublicKey && vm.internalIp) {
                await this._updateExistingPeers(vm);
            }

            let deployResult = { success: true };
            
            if (config.MODE === 'docker') {
                if (vm.type === 'app') {
                    logger.info(`Docker mode: деплой для ${vm.name}`);
                    deployResult = await this.deployViaDocker(vm);
                }
            } else {
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
     * 🔍 ПРЯМАЯ ПРОВЕРКА ЧЕРЕЗ NODE.JS / DOCKER API
     */
    async detectFramework(vmName) {
        try {
            logger.info(`🔍 Начало анализа проекта в ${vmName}...`);
            
            // 1. Проверяем наличие package.json через Docker API
            logger.info('⏳ Проверка наличия package.json через Docker API...');
            const packageExists = await hypervisor.fileExists(vmName, '/app/package.json');
            
            logger.info(`📋 Результат проверки: ${packageExists ? 'FOUND' : 'NOT_FOUND'}`);
            
            if (!packageExists) {
                logger.error('❌ package.json не найден!');
                const dirList = await hypervisor.listDirectory(vmName, '/app/');
                logger.error('📂 Содержимое /app/:', dirList);
                throw new Error('package.json не найден в репозитории');
            }
            
            logger.success('✅ package.json найден');

            // 2. Читаем файл через Docker API
            logger.info('📖 Чтение package.json...');
            let packageContent = await hypervisor.readFile(vmName, '/app/package.json');
            
            // Очищаем от возможных служебных символов
            packageContent = packageContent.trim();
            const jsonMatch = packageContent.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                packageContent = jsonMatch[0];
            }

            logger.info('📄 package.json успешно прочитан');
            logger.debug('📦 Содержимое:', packageContent.substring(0, 300));

            // 3. Парсим JSON
            const pkg = JSON.parse(packageContent);
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            const scripts = pkg.scripts || {};

            logger.info(`📦 Найденные зависимости: ${Object.keys(deps).length} пакетов`);
            logger.info(`📦 Ключевые зависимости: ${Object.keys(deps).filter(d => 
                ['next', 'react', 'vue', 'angular', 'nuxt', 'svelte', 'express', 'fastify', 'nest'].includes(d)
            ).join(', ')}`);

            // 4. Определение фреймворка
            if (deps['next'] || deps['nextjs']) {
                logger.success('✅ Определен фреймворк: Next.js');
                return 'nextjs';
            }
            if (deps['nuxt'] || deps['@nuxt/kit'] || deps['@nuxt/vue-app']) {
                logger.success('✅ Определен фреймворк: Nuxt.js');
                return 'nuxt';
            }
            if (deps['@angular/core'] || deps['@angular/cli']) {
                logger.success('✅ Определен фреймворк: Angular');
                return 'angular';
            }
            if (deps['@sveltejs/kit']) {
                logger.success('✅ Определен фреймворк: SvelteKit');
                return 'sveltekit';
            }
            if (deps['vite'] && deps['vue']) {
                logger.success('✅ Определен фреймворк: Vue + Vite');
                return 'vue';
            }
            if (deps['@vue/cli-service']) {
                logger.success('✅ Определен фреймворк: Vue CLI');
                return 'vue';
            }
            if (deps['vite'] && deps['react']) {
                logger.success('✅ Определен фреймворк: React + Vite');
                return 'react-vite';
            }
            if (deps['react-scripts']) {
                logger.success('✅ Определен фреймворк: React (CRA)');
                return 'react-cra';
            }
            if (deps['svelte']) {
                logger.success('✅ Определен фреймворк: Svelte');
                return 'svelte';
            }
            if (deps['@nestjs/core']) {
                logger.success('✅ Определен фреймворк: NestJS');
                return 'nest';
            }
            if (deps['express']) {
                logger.success('✅ Определен фреймворк: Express');
                return 'express';
            }
            if (deps['fastify']) {
                logger.success('✅ Определен фреймворк: Fastify');
                return 'fastify';
            }
            if (deps['koa']) {
                logger.success('✅ Определен фреймворк: Koa');
                return 'koa';
            }
            if (deps['hono']) {
                logger.success('✅ Определен фреймворк: Hono');
                return 'hono';
            }
            
            if (scripts.build && (scripts.build.includes('vite') || scripts.build.includes('webpack'))) {
                logger.success('✅ Определен фреймворк: SPA (Vite/Webpack)');
                return 'spa';
            }

            logger.info('ℹ️ Специфичные фреймворки не найдены, используем Node.js');
            return 'node';
        } catch (e) {
            logger.error('❌ Критическая ошибка определения фреймворка:', e.message);
            logger.error('📋 Stack:', e.stack);
            
            try {
                const dirList = await hypervisor.listDirectory(vmName, '/app/');
                logger.error('📂 Итоговое содержимое /app/:', dirList);
            } catch (listErr) {
                logger.error('Не удалось получить список файлов:', listErr.message);
            }
            
            return 'node';
        }
    }

    getInstallCommands(framework) {
        switch (framework) {
            case 'nextjs':
            case 'react-cra':
            case 'react-vite':
            case 'vue':
            case 'angular':
            case 'nuxt':
            case 'svelte':
            case 'sveltekit':
            case 'nest':
            case 'express':
            case 'fastify':
            case 'koa':
            case 'hono':
            case 'node':
            case 'spa':
                return [
                    'npm install --legacy-peer-deps || npm install',
                    'npm ci --legacy-peer-deps || npm ci || true'
                ];
            case 'django':
            case 'flask':
            case 'python':
                return [
                    'pip install --upgrade pip',
                    'pip install -r requirements.txt',
                    'pip install gunicorn'
                ];
            case 'go':
                return [
                    'go mod download',
                    'go mod tidy'
                ];
            case 'rust':
                return [
                    'cargo fetch',
                    'cargo build --release'
                ];
            case 'php':
                return [
                    'composer install --no-dev --optimize-autoloader'
                ];
            default:
                return ['npm install'];
        }
    }

    getBuildCommands(framework) {
        switch (framework) {
            case 'nextjs':
                // Next.js требует особые переменные окружения для сборки
                return [
                    'export NODE_ENV=production',
                    'export NEXT_TELEMETRY_DISABLED=1',
                    'npm run build'
                ];
            case 'nuxt':
                return [
                    'export NODE_ENV=production',
                    'npm run build'
                ];
            case 'react-cra':
            case 'react-vite':
            case 'vue':
            case 'angular':
            case 'svelte':
            case 'sveltekit':
            case 'nest':
            case 'spa':
                return ['npm run build'];
            case 'go':
                return ['go build -o app'];
            case 'rust':
                return ['cargo build --release'];
            case 'django':
            case 'flask':
            case 'python':
            case 'node':
            case 'express':
            case 'fastify':
            case 'koa':
            case 'hono':
            case 'php':
            case 'static':
                return [];
            default:
                return ['npm run build || true'];
        }
    }

    getStartCommand(framework) {
        const envSetup = 'export PORT=3000\nexport HOST=0.0.0.0\nexport NODE_ENV=production';
        
        switch (framework) {
            case 'nextjs':
                return `${envSetup}\nnpm run start -- -p 3000 -H 0.0.0.0`;
            case 'nuxt':
                return `${envSetup}\nnpm run start -- -p 3000 -H 0.0.0.0`;
            case 'react-cra':
            case 'react-vite':
            case 'vue':
            case 'angular':
            case 'svelte':
            case 'sveltekit':
            case 'spa':
                return `${envSetup}\nnpx serve -s build -l 3000 || npx serve -s dist -l 3000 || npx http-server build -p 3000`;
            case 'nest':
                return `${envSetup}\nnpm run start:prod`;
            case 'node':
            case 'express':
            case 'fastify':
            case 'koa':
            case 'hono':
                return `${envSetup}\nif grep -q '"start"' package.json; then npm start; elif [ -f server.js ]; then node server.js; elif [ -f index.js ]; then node index.js; elif [ -f app.js ]; then node app.js; else npm start; fi`;
            case 'django':
                return `${envSetup}\ngunicorn --bind 0.0.0.0:3000 --workers 3 --timeout 120 wsgi:application || python manage.py runserver 0.0.0.0:3000`;
            case 'flask':
                return `${envSetup}\ngunicorn --bind 0.0.0.0:3000 --workers 3 app:app || python app.py`;
            case 'python':
                return `${envSetup}\npython main.py || python app.py || python index.py`;
            case 'go':
                return `${envSetup}\n./app || go run main.go`;
            case 'rust':
                return `${envSetup}\n./target/release/app || cargo run --release`;
            case 'php':
                return `${envSetup}\nphp -S 0.0.0.0:3000 -t public || php -S 0.0.0.0:3000`;
            case 'static':
                return `${envSetup}\nnpx serve -s . -l 3000 || npx http-server -p 3000`;
            default:
                return `${envSetup}\nnpm start`;
        }
    }

    async deployViaDocker(vm) {
        const logStep = async (step, total, message, emoji = '🔧') => {
            const msg = `${emoji} [${step}/${total}] ${message}`;
            logger.info(msg);
        };

        try {
            logger.info(`🚀 Начало полного деплоя приложения ${vm.name}`);
            logger.info(`📦 GitHub URL: ${vm.githubUrl || 'N/A'}`);
            logger.info(`🏗 Фреймворк: ${vm.framework || 'Auto-detect'}`);
            
            // 1. Подготовка окружения
            await logStep(1, 6, 'Подготовка окружения и установка инструментов', '🛠');
            try {
                await hypervisor.execCommand(vm.name, 'apt-get update -qq');
                await hypervisor.execCommand(vm.name, 'which git || apt-get install -y -qq git');
                await hypervisor.execCommand(vm.name, 'which curl || apt-get install -y -qq curl');
                await hypervisor.execCommand(vm.name, 'which build-essential || apt-get install -y -qq build-essential');
                await hypervisor.execCommand(vm.name, 'which python3 || apt-get install -y -qq python3 python3-pip');
                logger.success('✅ Окружение подготовлено');
            } catch (e) {
                logger.warn('⚠️ Некоторые инструменты уже установлены:', e.message);
            }

            // 2. Клонирование кода
            if (vm.githubUrl) {
                await logStep(2, 6, `Клонирование репозитория ${vm.githubUrl}`, '📥');
                await hypervisor.execCommand(vm.name, 'rm -rf /app/* /app/.* 2>/dev/null || true');
                await hypervisor.execCommand(vm.name, `git clone ${vm.githubUrl} .`);
                
                logger.info('⏳ Ожидание записи файлов на диск...');
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                const dirList = await hypervisor.listDirectory(vm.name, '/app/');
                logger.info('📂 Содержимое директории после клонирования:', dirList);
                
                logger.success('✅ Код склонирован');
                
                // 3. Определение фреймворка
                await logStep(3, 6, 'Анализ проекта и определение фреймворка', '🔍');
                let framework = vm.framework;
                if (!framework || framework === 'unknown') {
                    framework = await this.detectFramework(vm.name);
                    await vm.update({ framework });
                    logger.success(`✅ Фреймворк определен: ${framework.toUpperCase()}`);
                } else {
                    logger.success(`✅ Используем указанный фреймворк: ${framework.toUpperCase()}`);
                }

                // 4. Установка зависимостей
                await logStep(4, 6, `Установка зависимостей для ${framework}`, '📦');
                const installCommands = this.getInstallCommands(framework);
                for (const cmd of installCommands) {
                    try {
                        const installOutput = await hypervisor.execCommand(vm.name, cmd);
                        logger.info(`📦 Вывод установки: ${installOutput.substring(0, 500)}`);
                    } catch (e) {
                        logger.warn(`⚠️ Команда установки завершилась с предупреждением: ${cmd}`);
                        logger.warn(`⚠️ Ошибка: ${e.message}`);
                    }
                }
                logger.success('✅ Зависимости установлены');

                // 5. Сборка приложения - 🔥 ИСПРАВЛЕНА ПРОБЛЕМА
                await logStep(5, 6, `Сборка приложения ${framework}`, '🏗');
                const buildCommands = this.getBuildCommands(framework);
                
                if (buildCommands.length > 0) {
                    logger.info(`🔨 Команды сборки: ${buildCommands.join(' && ')}`);
                    
                    for (const cmd of buildCommands) {
                        try {
                            logger.info(`🔨 Выполнение: ${cmd}`);
                            const buildOutput = await hypervisor.execCommand(vm.name, cmd);
                            
                            // Логируем вывод сборки (важно для отладки!)
                            if (buildOutput && buildOutput.length > 0) {
                                logger.info(`📋 Вывод сборки (${cmd}):`);
                                // Разбиваем на строки и логируем по частям
                                const lines = buildOutput.split('\n');
                                for (const line of lines.slice(0, 50)) { // Первые 50 строк
                                    if (line.trim()) {
                                        logger.info(`   ${line}`);
                                    }
                                }
                                if (lines.length > 50) {
                                    logger.info(`   ... и еще ${lines.length - 50} строк`);
                                }
                            }
                            
                            // Проверяем наличие ошибок в выводе
                            if (buildOutput.toLowerCase().includes('error') && !buildOutput.toLowerCase().includes('no errors')) {
                                logger.warn('⚠️ В выводе сборки найдены предупреждения об ошибках');
                            }
                            
                        } catch (e) {
                            // 🔥 КРИТИЧЕСКАЯ ОШИБКА - не игнорируем для Next.js
                            logger.error(`❌ Ошибка выполнения команды: ${cmd}`);
                            logger.error(`❌ Детали ошибки: ${e.message}`);
                            
                            // Для Next.js ошибка сборки критична
                            if (framework === 'nextjs') {
                                throw new Error(`Сборка Next.js не удалась: ${e.message}`);
                            }
                            
                            logger.warn(`⚠️ Сборка завершилась с предупреждением: ${cmd}`);
                        }
                    }
                    
                    // Проверяем результат сборки для Next.js
                    if (framework === 'nextjs') {
                        logger.info('🔍 Проверка результата сборки Next.js...');
                        
                        // Проверяем наличие папки .next
                        const nextDirExists = await hypervisor.fileExists(vm.name, '/app/.next');
                        logger.info(`📁 Папка .next существует: ${nextDirExists}`);
                        
                        if (!nextDirExists) {
                            // Пробуем найти папку build (для других фреймворков)
                            const buildDirExists = await hypervisor.fileExists(vm.name, '/app/build');
                            logger.info(`📁 Папка build существует: ${buildDirExists}`);
                            
                            if (!buildDirExists) {
                                logger.error('❌ Папка .next не создана! Сборка могла не завершиться успешно.');
                                const dirList = await hypervisor.listDirectory(vm.name, '/app/');
                                logger.error('📂 Содержимое /app/:', dirList);
                            }
                        } else {
                            logger.success('✅ Папка .next создана успешно');
                        }
                    }
                    
                    logger.success('✅ Сборка завершена');
                } else {
                    logger.info('ℹ️ Сборка не требуется для этого фреймворка');
                }

                // 6. Запуск приложения
                await logStep(6, 6, 'Настройка и запуск приложения', '🚀');
                
                const startCmd = this.getStartCommand(framework);
                const startScript = `#!/bin/sh\n${startCmd}`;
                
                logger.info(`Команда запуска: ${startCmd.split('\n').pop()}`);
                await hypervisor.execCommand(vm.name, `echo '${startScript}' > /app/start.sh`);
                await hypervisor.execCommand(vm.name, 'chmod +x /app/start.sh');

                const scriptExists = await hypervisor.fileExists(vm.name, '/app/start.sh');
                if (!scriptExists) {
                    throw new Error('Не удалось создать start.sh');
                }

                await hypervisor.updateContainerCommand(vm.name, ['/app/start.sh']);

                logger.info('Перезапуск контейнера для применения настроек...');
                await hypervisor.restartVM(vm.name);
                
                await new Promise(resolve => setTimeout(resolve, 8000));
                
                logger.success('✅ Приложение запущено');
            } else {
                logger.info('ℹ️ GitHub URL не указан, пропуск деплоя.');
            }
            
            logger.success(`🎉 Деплой ${vm.name} успешно завершен!`);
            return { success: true };
        } catch (error) {
            logger.error('❌ Ошибка деплоя:', error);
            return { success: false, error: error.message };
        }
    }

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

    async getAllVMs(projectId = null) {
        const where = {};
        if (projectId) {
            where.projectId = projectId;
        }
        return await VM.findAll({ 
            where,
            order: [['createdAt', 'DESC']]
        });
    }

    async getVM(id, projectId = null) {
        const where = { id };
        if (projectId) {
            where.projectId = projectId;
        }
        return await VM.findOne({ where });
    }

    async deleteVM(id, projectId = null) {
        const vm = await this.getVM(id, projectId);
        if (!vm) {
            throw new Error('ВМ не найдена или доступ запрещен');
        }

        logger.info(`Удаление ВМ: ${vm.name}`);

        // --- Remove from WireGuard peers ---
        if (vm.wgPublicKey) {
            try {
                const peers = await VM.findAll({
                    where: {
                        projectId: vm.projectId,
                        id: { [Op.ne]: vm.id },
                        status: { [Op.or]: ['running', 'deployed'] }
                    }
                });
                
                for (const peer of peers) {
                    try {
                        logger.info(`Removing WireGuard peer from ${peer.name}...`);
                        await hypervisor.execCommand(peer.name, `wg set wg0 peer ${vm.wgPublicKey} remove`);
                        await hypervisor.execCommand(peer.name, 'wg-quick save wg0 || true');
                    } catch (e) {
                        logger.warn(`Failed to remove peer from ${peer.name}: ${e.message}`);
                    }
                }
            } catch (e) {
                logger.warn(`Error cleaning up WireGuard peers: ${e.message}`);
            }
        }
        // -----------------------------------

        try {
            await hypervisor.deleteVM(vm.name);
        } catch (e) {
            logger.warn(`Ошибка удаления VM в гипервизоре: ${e.message}`);
        }
        
        if (vm.ip && config.MODE !== 'docker') {
            try {
                ssh.disconnect(vm.ip);
            } catch (e) {
                logger.warn(`Ошибка отключения SSH: ${e.message}`);
            }
        }
        
        await vm.destroy();
        
        logger.success(`ВМ ${vm.name} удалена`);
        return true;
    }

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

    async startVM(id, projectId = null) {
        const vm = await this.getVM(id, projectId);
        if (!vm) {
            throw new Error('ВМ не найдена или доступ запрещен');
        }

        if (vm.status === 'running' || vm.status === 'deployed') {
            throw new Error('ВМ уже запущена');
        }

        await hypervisor.startVM(vm.name);
        
        if (config.MODE !== 'docker') {
            await this.waitForVM(vm.name, 60000);
        } else {
             await this.waitForVM(vm.name, 60000);
        }

        await vm.update({ status: 'running' });
        
        logger.info(`ВМ ${vm.name} запущена`);
        return true;
    }

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

    async logResourceUsage(vmId, cpuUsage, ramUsage) {
        return await ResourceLog.create({
            vmId,
            cpuUsage,
            ramUsage,
            timestamp: new Date()
        });
    }

    async getVMResourceStats(vmId, hours = 24) {
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

    async createBackup(vmId, name, projectId = null) {
        const vm = await this.getVM(vmId, projectId);
        if (!vm) throw new Error('ВМ не найдена');
    
        if (config.MODE !== 'docker') throw new Error('Бекапы поддерживаются только в режиме Docker');
    
        const timestamp = Date.now();
        const backupName = `backup-${vm.name}-${timestamp}`;
        const backupDir = config.BACKUP_DIR || '/app/data/backups';
        
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true, mode: 0o755 });
        }
    
        const volumeArchiveName = `${backupName}.tar`;
        const volumePath = path.join(backupDir, volumeArchiveName);
        const volumeName = vm.name;
        
        const backup = await Backup.create({
            vmId: vm.id,
            name: name || `Backup ${new Date().toLocaleString()}`,
            imageTag: backupName,
            volumePath: volumePath,
            volumeName: volumeName,
            status: 'creating'
        });
    
        try {
            await hypervisor.createBackup(vm.name, backupName);
            await hypervisor.createVolumeBackup(volumeName, volumePath);
    
            if (fs.existsSync(volumePath)) {
                const stats = fs.statSync(volumePath);
                await backup.update({ 
                    status: 'ready',
                    size: Math.round(stats.size / (1024 * 1024))
                });
            } else {
                throw new Error(`Файл бекапа не создан: ${volumePath}`);
            }
    
            return backup;
        } catch (e) {
            await backup.update({ status: 'error', error: e.message });
            if (fs.existsSync(volumePath)) fs.unlinkSync(volumePath);
            throw e;
        }
    }

    async getBackups(vmId, projectId = null) {
        const vm = await this.getVM(vmId, projectId);
        if (!vm) throw new Error('ВМ не найдена');
        return await Backup.findAll({ where: { vmId }, order: [['createdAt', 'DESC']] });
    }

    async restoreBackup(vmId, backupId, projectId = null) {
        const vm = await this.getVM(vmId, projectId);
        if (!vm) throw new Error('ВМ не найдена');

        const backup = await Backup.findByPk(backupId);
        if (!backup || backup.vmId !== vmId) throw new Error('Бекап не найден');
        if (config.MODE !== 'docker') throw new Error('Только Docker режим');

        await vm.update({ status: 'deploying' });
        logger.info(`Начало восстановления ВМ ${vm.name} из бекапа ${backup.name}...`);

        try {
            try { await this.stopVM(vmId, projectId); } catch (e) { logger.warn(e.message); }

            try {
                await hypervisor.ensureConnection();
                const containers = await hypervisor.docker.listContainers({ all: true, filters: { name: [vm.name] } });
                if (containers.length > 0) {
                    const container = hypervisor.docker.getContainer(vm.name);
                    await container.remove({ force: true });
                }
            } catch (e) { logger.warn(e.message); }

            const volumeName = vm.name;

            if (backup.volumePath && fs.existsSync(backup.volumePath)) {
                await hypervisor.restoreVolumeBackup(volumeName, backup.volumePath);
            }

            await vm.update({ dockerImage: backup.imageTag, type: 'docker' });

            await hypervisor.createVM({
                name: vm.name,
                type: 'docker',
                dockerImage: backup.imageTag,
                framework: vm.framework,
                ram: vm.ram,
                cpu: vm.cpu,
                diskPath: volumeName,
                hostPort: vm.hostPort,
                network: config.VM_NETWORK || 'app-network'
            });

            await this.waitForVM(vm.name, 60000);
            await vm.update({ status: 'running' });
            logger.success(`ВМ ${vm.name} успешно восстановлена из бекапа`);
            return true;

        } catch (error) {
            logger.error(`Ошибка восстановления ВМ ${vm.name}:`, error);
            await vm.update({ status: 'error', error: error.message });
            throw error;
        }
    }

    async resizeVM(vmId, ram, cpu, projectId = null) {
        const vm = await this.getVM(vmId, projectId);
        if (!vm) throw new Error('ВМ не найдена');

        logger.info(`Изменение ресурсов ВМ ${vm.name}: RAM ${ram}MB, CPU ${cpu}`);
        await vm.update({ ram, cpu });

        if (config.MODE === 'docker') {
            try {
                await hypervisor.updateContainerResources(vm.name, ram, cpu);
            } catch (e) {
                logger.warn(`Не удалось обновить ресурсы на лету: ${e.message}`);
            }
        }
        
        return vm;
    }

    async checkHypervisorConnection() {
        return await hypervisor.checkConnection();
    }

    async getLogs(id, projectId = null) {
        const vm = await this.getVM(id, projectId);
        if (!vm) throw new Error('ВМ не найдена');

        if (config.MODE === 'docker') {
            return await hypervisor.getLogs(vm.name);
        } else {
            if (!vm.ip) return 'IP не получен';
            return await ssh.getLogs(vm.ip, vm.name);
        }
    }

    getModeInfo() {
        return {
            mode: config.MODE,
            isDocker: config.MODE === 'docker',
            isLibvirt: config.MODE !== 'docker'
        };
    }
}

module.exports = new VMManager();