// server/services/cloudinit.js
const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const config = require('../config');
const logger = require('../utils/logger');

class CloudInitService {
    /**
     * Создаёт cloud-init ISO для виртуальной машины
     * @param {Object} vmConfig - Конфигурация ВМ
     * @param {string} vmConfig.name - Имя ВМ
     * @param {string} vmConfig.id - ID ВМ
     * @param {string} vmConfig.sshPublicKey - SSH публичный ключ
     * @param {string} vmConfig.type - Тип ВМ: 'k8s' | 'app' | 'generic'
     * @param {string} vmConfig.framework - Фреймворк для типа 'app'
     * @param {string} vmConfig.dockerImage - Кастомный Docker образ (опционально)
     * @param {number} vmConfig.hostPort - Порт хоста для проброса
     * @param {Array} vmConfig.cmd - Команда запуска (опционально)
     */
    async createISO(vmConfig) {
        const { 
            name: vmName, 
            id: vmId, 
            sshPublicKey, 
            type = 'generic',
            framework,
            dockerImage,
            hostPort = 3000,
            cmd 
        } = vmConfig;

        // Создаём директории если не существуют
        const cloudInitDir = config.CLOUD_INIT_DIR || '/var/lib/libvirt/cloud-init';
        const isoDir = config.ISO_DIR || '/var/lib/libvirt/isos';
        [cloudInitDir, isoDir].forEach(dir => {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        });

        const metaFile = path.join(cloudInitDir, `${vmName}-meta-data`);
        const userFile = path.join(cloudInitDir, `${vmName}-user-data`);
        const networkFile = path.join(cloudInitDir, `${vmName}-network-config`);
        const isoFile = path.join(isoDir, `${vmName}-cidata.iso`);

        // === Meta-data ===
        fs.writeFileSync(metaFile, `instance-id: ${vmId || vmName}
local-hostname: ${vmName}
`);

        // === Network-config (опционально, для статического IP если нужно) ===
        fs.writeFileSync(networkFile, `version: 2
ethernets:
  eth0:
    dhcp4: true
`);

        // === User-data ===
        const userData = this._generateUserData({
            vmName,
            sshPublicKey,
            type,
            framework,
            dockerImage,
            hostPort,
            cmd
        });
        fs.writeFileSync(userFile, userData);

        // === Генерация ISO ===
        try {
            // Пробуем cloud-localds (предпочтительно)
            await execAsync(`cloud-localds "${isoFile}" "${userFile}" "${metaFile}" --network-config="${networkFile}"`);
        } catch (e) {
            logger.warn(`cloud-localds не доступен: ${e.message}, пробуем genisoimage...`);
            try {
                // Fallback на genisoimage/xorriso
                await execAsync(
                    `genisoimage -output "${isoFile}" -volid cidata -joliet -rock "${userFile}" "${metaFile}" "${networkFile}"`
                );
            } catch (e2) {
                logger.warn(`genisoimage не доступен: ${e2.message}, пробуем xorriso...`);
                await execAsync(
                    `xorriso -as mkisofs -output "${isoFile}" -volid cidata -joliet -rock "${userFile}" "${metaFile}" "${networkFile}"`
                );
            }
        }

        logger.success(`Cloud-init ISO создан: ${isoFile}`);
        return isoFile;
    }

    /**
     * Генерирует user-data YAML в зависимости от типа ВМ
     */
    _generateUserData({ vmName, sshPublicKey, type, framework, dockerImage, hostPort, cmd, wgPrivateKey, wgInternalIp, wgPeers }) {
        const sshUser = config.SSH_USER || 'vmuser';
        const appDir = `/home/${sshUser}/app`;
        
        // Базовые пакеты для всех ВМ
        const basePackages = [
            'curl', 'git', 'wget', 'build-essential', 'ca-certificates',
            'gnupg', 'lsb-release', 'software-properties-common', 'apt-transport-https',
            'wireguard', 'wireguard-tools'
        ];

        // Команды для установки Docker (нужен для app/k8s с контейнерами)
        const dockerSetup = `
  # Установка Docker
  - install -m 0755 -d /etc/apt/keyrings
  - curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  - chmod a+r /etc/apt/keyrings/docker.gpg
  - echo "deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \$(. /etc/os-release && echo "\$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
  - apt-get update
  - apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  - usermod -aG docker ${sshUser}
  - systemctl enable docker
  - systemctl start docker
`.trim();

        // Установка Node.js 25.x
        const nodeSetup = `
  # Установка Node.js 25.x
  - curl -fsSL https://deb.nodesource.com/setup_25.x | bash -
  - apt-get install -y nodejs
  - npm config set unsafe-perm true
  - npm install -g pnpm yarn nodemon
`.trim();

        // Установка Python 3.11 + pip
        const pythonSetup = `
  # Установка Python 3.11
  - add-apt-repository -y ppa:deadsnakes/ppa
  - apt-get update
  - apt-get install -y python3.11 python3.11-venv python3.11-dev python3-pip
  - update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1
  - python3 -m pip install --upgrade pip setuptools wheel
  - pip3 install virtualenv uvicorn gunicorn flask django
`.trim();

        // Установка Go
        const goSetup = `
  # Установка Go 1.21
  - curl -fsSL https://go.dev/dl/go1.21.0.linux-amd64.tar.gz -o /tmp/go.tar.gz
  - rm -rf /usr/local/go && tar -C /usr/local -xzf /tmp/go.tar.gz
  - echo 'export PATH=$PATH:/usr/local/go/bin' >> /etc/environment
  - echo 'export GOPATH=$HOME/go' >> /etc/environment
  - echo 'export PATH=$PATH:$GOPATH/bin' >> /etc/environment
`.trim();

        // Установка Rust
        const rustSetup = `
  # Установка Rust
  - curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  - echo 'source $HOME/.cargo/env' >> /etc/environment
`.trim();

        // Установка PHP
        const phpSetup = `
  # Установка PHP 8.2
  - add-apt-repository -y ppa:ondrej/php
  - apt-get update
  - apt-get install -y php8.2 php8.2-cli php8.2-fpm php8.2-mysql php8.2-curl php8.2-zip php8.2-mbstring php8.2-xml composer
`.trim();

        // Настройка приложения в зависимости от фреймворка
        const appSetup = {
            'node': `
  # Настройка Node.js приложения
  - mkdir -p ${appDir} && chown ${sshUser}:${sshUser} ${appDir}
  - cd ${appDir} && npm init -y
`,
            'nextjs': `
  # Настройка Next.js
  - mkdir -p ${appDir} && chown ${sshUser}:${sshUser} ${appDir}
  - cd ${appDir} && npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm || true
`,
            'react-cra': `
  # Настройка React (CRA)
  - mkdir -p ${appDir} && chown ${sshUser}:${sshUser} ${appDir}
  - cd ${appDir} && npx create-react-app . --template typescript || true
`,
            'react-vite': `
  # Настройка React + Vite
  - mkdir -p ${appDir} && chown ${sshUser}:${sshUser} ${appDir}
  - cd ${appDir} && npm create vite@latest . -- --template react-ts || true
`,
            'vue': `
  # Настройка Vue 3
  - mkdir -p ${appDir} && chown ${sshUser}:${sshUser} ${appDir}
  - cd ${appDir} && npm create vue@latest . --default || true
`,
            'angular': `
  # Настройка Angular
  - npm install -g @angular/cli
  - mkdir -p ${appDir} && chown ${sshUser}:${sshUser} ${appDir}
  - cd ${appDir} && ng new . --skip-git --routing --style=css --ssr=false || true
`,
            'nuxt': `
  # Настройка Nuxt 3
  - mkdir -p ${appDir} && chown ${sshUser}:${sshUser} ${appDir}
  - cd ${appDir} && npx nuxi@latest init . --packageManager=npm || true
`,
            'svelte': `
  # Настройка Svelte
  - mkdir -p ${appDir} && chown ${sshUser}:${sshUser} ${appDir}
  - cd ${appDir} && npm create vite@latest . -- --template svelte-ts || true
`,
            'sveltekit': `
  # Настройка SvelteKit
  - mkdir -p ${appDir} && chown ${sshUser}:${sshUser} ${appDir}
  - cd ${appDir} && npm create svelte@latest . --template skeleton --types=typescript --no-add-ons --no-install || true
`,
            'nest': `
  # Настройка NestJS
  - npm install -g @nestjs/cli
  - mkdir -p ${appDir} && chown ${sshUser}:${sshUser} ${appDir}
  - cd ${appDir} && nest new . --skip-git --package-manager npm || true
`,
            'express': `
  # Настройка Express
  - mkdir -p ${appDir} && chown ${sshUser}:${sshUser} ${appDir}
  - cd ${appDir} && npm init -y && npm install express cors dotenv
`,
            'django': `
  # Настройка Django
  - mkdir -p ${appDir} && chown ${sshUser}:${sshUser} ${appDir}
  - cd ${appDir} && python3 -m venv venv && source venv/bin/activate && pip install django djangorestframework gunicorn
`,
            'flask': `
  # Настройка Flask
  - mkdir -p ${appDir} && chown ${sshUser}:${sshUser} ${appDir}
  - cd ${appDir} && python3 -m venv venv && source venv/bin/activate && pip install flask flask-cors gunicorn
`,
            'rust': `
  # Настройка Rust проекта
  - mkdir -p ${appDir} && chown ${sshUser}:${sshUser} ${appDir}
  - cd ${appDir} && source $HOME/.cargo/env && cargo init .
`,
            'php': `
  # Настройка PHP проекта
  - mkdir -p ${appDir} && chown ${sshUser}:${sshUser} ${appDir}
  - cd ${appDir} && composer init --no-interaction --require="php:^8.2"
`,
            'go': `
  # Настройка Go проекта
  - mkdir -p ${appDir} && chown ${sshUser}:${sshUser} ${appDir}
  - cd ${appDir} && export PATH=$PATH:/usr/local/go/bin && go mod init app
`,
            'python': `
  # Настройка Python проекта
  - mkdir -p ${appDir} && chown ${sshUser}:${sshUser} ${appDir}
  - cd ${appDir} && python3 -m venv venv && source venv/bin/activate && pip install fastapi uvicorn
`
        };

        // Команда запуска по умолчанию для разных типов
        let runCmd = cmd;
        if (!runCmd) {
            if (type === 'k8s') {
                runCmd = 'k3s server --disable-agent';
            } else if (type === 'app') {
                // Default keep-alive для app
                runCmd = 'while :; do sleep 3600; done';
            } else {
                // Generic: просто держим ВМ запущенной
                runCmd = 'while :; do sleep 3600; done';
            }
        }
        const runCmdStr = Array.isArray(runCmd) ? runCmd.join(' ') : runCmd;

        // Формируем runcmd секцию
        const runcmd = [];
        
        // Базовые настройки
        runcmd.push(`echo "VM: ${vmName} initialized" >> /var/log/vm-init.log`);
        runcmd.push(`setcap 'cap_net_bind_service=+ep' /usr/bin/node 2>/dev/null || true`);
        
        // WireGuard Setup
        if (wgPrivateKey && wgInternalIp) {
            runcmd.push(`echo "Configuring WireGuard..." >> /var/log/vm-init.log`);
            runcmd.push(`systemctl enable wg-quick@wg0`);
            runcmd.push(`systemctl start wg-quick@wg0`);
        }

        // Установка Docker для app/k8s типов
        if (type === 'app' || type === 'k8s') {
            dockerSetup.split('\n').forEach(line => line.trim() && runcmd.push(line));
        }

        // Установка runtime в зависимости от фреймворка
        if (type === 'app' && framework) {
            if (['node', 'nextjs', 'react-cra', 'react-vite', 'vue', 'angular', 'nuxt', 'svelte', 'sveltekit', 'nest', 'express'].includes(framework)) {
                nodeSetup.split('\n').forEach(line => line.trim() && runcmd.push(line));
            }
            if (['python', 'django', 'flask'].includes(framework)) {
                pythonSetup.split('\n').forEach(line => line.trim() && runcmd.push(line));
            }
            if (framework === 'go') {
                goSetup.split('\n').forEach(line => line.trim() && runcmd.push(line));
            }
            if (framework === 'rust') {
                rustSetup.split('\n').forEach(line => line.trim() && runcmd.push(line));
            }
            if (framework === 'php') {
                phpSetup.split('\n').forEach(line => line.trim() && runcmd.push(line));
            }
            
            // Настройка конкретного фреймворка
            if (appSetup[framework]) {
                appSetup[framework].split('\n').forEach(line => line.trim() && runcmd.push(line));
            }
        }

        // Для k8s типа: установка k3s
        if (type === 'k8s') {
            runcmd.push(`# Установка k3s`);
            runcmd.push(`curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server --disable-agent" sh -`);
            runcmd.push(`mkdir -p /output && cp /etc/rancher/k3s/k3s.yaml /output/kubeconfig.yaml 2>/dev/null || true`);
            runcmd.push(`chmod 666 /output/kubeconfig.yaml 2>/dev/null || true`);
        }

        // Создание директории приложения
        runcmd.push(`mkdir -p ${appDir}`);
        runcmd.push(`chown -R ${sshUser}:${sshUser} ${appDir}`);

        // Запуск пользовательской команды в фоне
        runcmd.push(`# Запуск entrypoint команды`);
        runcmd.push(`(cd ${appDir} && ${runCmdStr}) &`);
        runcmd.push(`echo "Entrypoint started: ${runCmdStr}" >> /var/log/vm-init.log`);

        // Финальный лог
        runcmd.push(`echo "Cloud-init completed for ${vmName} at $(date)" >> /var/log/cloud-init-done.log`);

        // Собираем YAML
        let userData = `#cloud-config
# Generated for VM: ${vmName}
# Type: ${type}${framework ? `, Framework: ${framework}` : ''}

# Пользователь с SSH доступом
users:
  - name: ${sshUser}
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - ${sshPublicKey?.trim() || ''}
    lock_passwd: true

# Обновление пакетов
package_update: true
package_upgrade: true

# Базовые пакеты
packages:
${basePackages.map(pkg => `  - ${pkg}`).join('\n')}

# Команды выполнения при загрузке
runcmd:
${runcmd.map(cmd => `  - ${cmd}`).join('\n')}

# Финальные команды
final_message: "Cloud-init для ${vmName} завершён после $UPTIME секунд"
`;

        // Add write_files for WireGuard config
        if (wgPrivateKey && wgInternalIp) {
            let wgConfig = `[Interface]
PrivateKey = ${wgPrivateKey}
Address = ${wgInternalIp}/24
ListenPort = 51820
SaveConfig = true
`;
            if (wgPeers && wgPeers.length > 0) {
                wgPeers.forEach(peer => {
                    wgConfig += `
[Peer]
PublicKey = ${peer.publicKey}
AllowedIPs = ${peer.allowedIps}
Endpoint = ${peer.endpoint}
PersistentKeepalive = 25
`;
                });
            }

            userData += `
write_files:
  - path: /etc/wireguard/wg0.conf
    permissions: '0600'
    content: |
${wgConfig.split('\n').map(l => '      ' + l).join('\n')}
`;
        }

        return userData;
    }

    /**
     * Скачивает cloud image (Ubuntu Cloud)
     */
    async downloadCloudImage() {
        const imagePath = config.CLOUD_IMAGE_PATH;
        
        if (fs.existsSync(imagePath)) {
            const stats = fs.statSync(imagePath);
            // Проверяем что файл не пустой и скачан недавно (< 7 дней)
            const ageDays = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24);
            if (stats.size > 100 * 1024 * 1024 && ageDays < 7) {
                logger.info(`Cloud image уже существует и актуален: ${imagePath}`);
                return imagePath;
            }
        }

        // Создаём директорию если нужно
        const imageDir = path.dirname(imagePath);
        if (!fs.existsSync(imageDir)) fs.mkdirSync(imageDir, { recursive: true });

        logger.info(`Скачивание cloud image: ${config.CLOUD_IMAGE_URL}`);
        
        try {
            // Используем wget с прогрессом и retry
            await execAsync(`wget --progress=bar:force -O "${imagePath}.tmp" "${config.CLOUD_IMAGE_URL}"`);
            
            // Проверка целостности (если есть checksum)
            if (config.CLOUD_IMAGE_CHECKSUM) {
                logger.info('Проверка контрольной суммы...');
                const algo = config.CLOUD_IMAGE_CHECKSUM.includes(':') 
                    ? config.CLOUD_IMAGE_CHECKSUM.split(':')[0] 
                    : 'sha256';
                await execAsync(`echo "${config.CLOUD_IMAGE_CHECKSUM}" | ${algo}sum -c --status`);
            }
            
            // Переименовываем временный файл
            fs.renameSync(`${imagePath}.tmp`, imagePath);
            
            logger.success(`Cloud image загружен: ${imagePath}`);
            return imagePath;
        } catch (err) {
            // Cleanup на случай ошибки
            if (fs.existsSync(`${imagePath}.tmp`)) {
                fs.unlinkSync(`${imagePath}.tmp`);
            }
            logger.error('Ошибка загрузки cloud image', err);
            throw err;
        }
    }

    /**
     * Очищает временные файлы cloud-init для ВМ
     */
    async cleanup(vmName) {
        const cloudInitDir = config.CLOUD_INIT_DIR || '/var/lib/libvirt/cloud-init';
        const isoDir = config.ISO_DIR || '/var/lib/libvirt/isos';
        
        const files = [
            path.join(cloudInitDir, `${vmName}-meta-data`),
            path.join(cloudInitDir, `${vmName}-user-data`),
            path.join(cloudInitDir, `${vmName}-network-config`),
            path.join(isoDir, `${vmName}-cidata.iso`)
        ];
        
        files.forEach(file => {
            try {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                    logger.debug(`Удалён файл: ${file}`);
                }
            } catch (e) {
                logger.warn(`Не удалось удалить ${file}: ${e.message}`);
            }
        });
    }

    /**
     * Проверяет наличие утилит для создания ISO
     */
    async checkDependencies() {
        const tools = ['cloud-localds', 'genisoimage', 'xorriso'];
        const available = [];
        
        for (const tool of tools) {
            try {
                await execAsync(`which ${tool}`);
                available.push(tool);
            } catch {
                // инструмент не найден
            }
        }
        
        if (available.length === 0) {
            throw new Error(
                'Не найдены утилиты для создания cloud-init ISO. ' +
                'Установите одну из: cloud-init (cloud-localds), genisoimage, или xorriso'
            );
        }
        
        logger.info(`Доступные инструменты для ISO: ${available.join(', ')}`);
        return available;
    }
}

module.exports = new CloudInitService();