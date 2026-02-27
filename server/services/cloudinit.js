// server/services/cloudinit.js
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const config = require('../config');
const logger = require('../utils/logger');

class CloudInitService {
    async createISO(vmName, vmId, sshPublicKey) {
        const metaFile = path.join(config.CLOUD_INIT_DIR, `${vmName}-meta.yaml`);
        const userFile = path.join(config.CLOUD_INIT_DIR, `${vmName}-user.yaml`);
        const isoFile = path.join(config.ISO_DIR, `${vmName}-cidata.iso`);

        // Meta data
        fs.writeFileSync(metaFile, `instance-id: ${vmId}
local-hostname: ${vmName}
`);

        // User data с установкой Node.js и настройкой SSH
        fs.writeFileSync(userFile, `#cloud-config
users:
  - name: ${config.SSH_USER}
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - ${sshPublicKey}

package_update: true
package_upgrade: true

packages:
  - curl
  - git
  - wget
  - build-essential

runcmd:
  # Установка Node.js 18.x
  - curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
  - apt-get install -y nodejs
  
  # Настройка npm
  - npm config set unsafe-perm true
  
  # Создание директории для приложения
  - mkdir -p /home/${config.SSH_USER}/app
  - chown ${config.SSH_USER}:${config.SSH_USER} /home/${config.SSH_USER}/app
  
  # Разрешение на использование порта 3000
  - setcap 'cap_net_bind_service=+ep' /usr/bin/node || true
  
  - echo "Cloud-init completed for ${vmName}" > /var/log/cloud-init-done.log
`);

        // Генерируем ISO
        return new Promise((resolve, reject) => {
            exec(`cloud-localds ${isoFile} ${userFile} ${metaFile}`, (err) => {
                if (err) {
                    logger.error('Ошибка создания cloud-init ISO', err);
                    reject(err);
                } else {
                    logger.success(`Cloud-init ISO создан: ${isoFile}`);
                    resolve(isoFile);
                }
            });
        });
    }

    async downloadCloudImage() {
        if (fs.existsSync(config.CLOUD_IMAGE_PATH)) {
            logger.info('Cloud image уже существует');
            return config.CLOUD_IMAGE_PATH;
        }

        return new Promise((resolve, reject) => {
            logger.info('Скачивание cloud image...');
            exec(`wget -O ${config.CLOUD_IMAGE_PATH} ${config.CLOUD_IMAGE_URL}`, (err) => {
                if (err) reject(err);
                else {
                    logger.success('Cloud image загружен');
                    resolve(config.CLOUD_IMAGE_PATH);
                }
            });
        });
    }
}

module.exports = new CloudInitService();