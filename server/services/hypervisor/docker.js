const Docker = require('dockerode');
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const logger = require('../../utils/logger');
const { exec } = require('child_process');

class DockerService {
    constructor() {
        this.connected = false;
        this.docker = null;
    }

    async ensureConnection() {
        if (!this.connected || !this.docker) {
            await this.checkConnection();
        }
        if (!this.docker) {
            throw new Error('Docker не подключен. Проверьте, что /var/run/docker.sock доступен.');
        }
        return this.docker;
    }

    async checkConnection() {
        try {
            this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
            await this.docker.ping();
            this.connected = true;
            logger.success('Подключено к Docker API');
            return true;
        } catch (err) {
            logger.error('Docker API недоступен', err.message);
            this.connected = false;
            this.docker = null;
            return false;
        }
    }

    async createDisk(vmName, sizeGB) {
        await this.ensureConnection();
        const volumeName = vmName;
        
        try {
            await this.docker.getVolume(volumeName).inspect();
            logger.info(`Том ${volumeName} уже существует`);
        } catch (e) {
            await this.docker.createVolume({
                Name: volumeName,
                Driver: 'local',
                Labels: {
                    'iaas.vm': vmName,
                    'iaas.created': new Date().toISOString()
                }
            });
            logger.info(`Том ${volumeName} создан`);
        }
        
        return volumeName;
    }

    async runCommand(cmd) {
        await this.ensureConnection();
        return new Promise((resolve, reject) => {
            exec(`docker ${cmd}`, { timeout: 30000 }, (err, stdout, stderr) => {
                if (err) reject(new Error(stderr || err.message));
                else resolve(stdout.trim());
            });
        });
    }

    async createVM(vmConfig) {
        await this.ensureConnection();
        
        let imageName;
        let cmd = vmConfig.cmd;
        let privileged = false;
        let env = ['PORT=3000', 'HOST=0.0.0.0', 'NODE_ENV=production'];

        if (vmConfig.type === 'k8s') {
            imageName = 'rancher/k3s:latest';
            cmd = ['server', '--disable-agent'];
            privileged = true;
            env = ['K3S_KUBECONFIG_OUTPUT=/output/kubeconfig.yaml', 'K3S_KUBECONFIG_MODE=666'];
        } else if (vmConfig.type === 'app') {
            if (vmConfig.dockerImage) {
                imageName = vmConfig.dockerImage;
            } else {
                const frameworks = {
                    'node': 'node:25',
                    'python': 'python:3.11',
                    'go': 'golang:1.21',
                    'nextjs': 'node:25',
                    'react-cra': 'node:25',
                    'react-vite': 'node:25',
                    'vue': 'node:25',
                    'angular': 'node:25',
                    'nuxt': 'node:25',
                    'svelte': 'node:25',
                    'sveltekit': 'node:25',
                    'nest': 'node:25',
                    'express': 'node:25',
                    'django': 'python:3.11',
                    'flask': 'python:3.11',
                    'rust': 'rust:latest',
                    'php': 'php:8.2'
                };
                imageName = frameworks[vmConfig.framework] || 'node:25';
            }
            if (!cmd) {
                cmd = ['sh', '-c', 'while :; do sleep 1; done'];
            }
        } else {
            if (vmConfig.dockerImage) {
                imageName = vmConfig.dockerImage;
                if (imageName.match(/^(ubuntu|alpine|debian|centos)(:|$)/)) {
                    cmd = ['sh', '-c', 'while :; do sleep 1; done'];
                }
            } else {
                imageName = 'ubuntu:latest';
                cmd = ['sh', '-c', 'while :; do sleep 1; done'];
            }
        }
        
        let imageExists = false;
        try {
            await this.docker.getImage(imageName).inspect();
            imageExists = true;
        } catch (e) {
            logger.info(`Образ ${imageName} не найден, скачивание...`);
        }

        if (!imageExists) {
            await new Promise((resolve, reject) => {
                this.docker.pull(imageName, (err, stream) => {
                    if (err) return reject(err);
                    this.docker.modem.followProgress(stream, (err) => {
                        if (err) return reject(err);
                        resolve();
                    });
                });
            });
            logger.success(`Образ ${imageName} загружен`);
        }

        const volumeName = vmConfig.diskPath;

        const container = await this.docker.createContainer({
            Image: imageName,
            name: vmConfig.name,
            Cmd: cmd,
            Env: env,
            Tty: true,
            HostConfig: {
                PortBindings: {
                    '3000/tcp': [{ HostPort: String(vmConfig.hostPort) }],
                    ...(vmConfig.type === 'k8s' ? { '6443/tcp': [{ HostPort: String(vmConfig.hostPort + 10000) }] } : {})
                },
                Mounts: [
                    {
                        Type: 'volume',
                        Source: volumeName,
                        Target: '/app',
                        ReadOnly: false
                    }
                ],
                Privileged: privileged,
                RestartPolicy: {
                    Name: 'unless-stopped'
                },
                ...(vmConfig.ram ? { Memory: vmConfig.ram * 1024 * 1024 } : {}),
                ...(vmConfig.cpu ? { NanoCpus: vmConfig.cpu * 1000000000 } : {}),
                LogConfig: {
                    Type: 'json-file',
                    Config: {
                        'max-size': '50m',
                        'max-file': '5'
                    }
                },
                NetworkMode: vmConfig.network || 'app-network'
            },
            WorkingDir: '/app'
        });

        await container.start();
        logger.success(`Контейнер ${vmConfig.name} запущен`);
        return true;
    }

    async updateContainerCommand(vmName, newCmd) {
        await this.ensureConnection();
        try {
            const container = this.docker.getContainer(vmName);
            
            await container.update({
                Cmd: newCmd
            });
            
            logger.info(`Команда контейнера ${vmName} обновлена на: ${newCmd.join(' ')}`);
            return true;
        } catch (e) {
            logger.error(`Ошибка обновления команды контейнера ${vmName}:`, e.message);
            throw e;
        }
    }

    async execCommand(vmName, cmd, timeout = 300000) { // 🔥 Увеличен таймаут до 5 минут
        await this.ensureConnection();
        const container = this.docker.getContainer(vmName);
        
        const exec = await container.exec({
            Cmd: ['sh', '-c', cmd],
            AttachStdout: true,
            AttachStderr: true,
            Tty: false
        });

        const stream = await exec.start({ hijack: true, stdin: false });
        
        return new Promise((resolve, reject) => {
            let output = '';
            
            stream.on('data', chunk => {
                output += chunk.toString('utf8');
            });
            
            stream.on('end', () => {
                const cleanOutput = output.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
                resolve(cleanOutput);
            });
            
            stream.on('error', err => {
                reject(err);
            });
            
            // 🔥 Увеличенный таймаут для длительных операций (сборка)
            setTimeout(() => {
                stream.destroy();
                reject(new Error(`Timeout executing command: ${cmd} (${timeout}ms)`));
            }, timeout);
        });
    }

    /**
     * ✅ ПРЯМАЯ ПРОВЕРКА: Проверяет наличие файла через Docker API
     */
    async fileExists(vmName, filePath) {
        await this.ensureConnection();
        try {
            const container = this.docker.getContainer(vmName);
            
            // Пытаемся получить архив с файлом - если файл есть, успех
            const archive = await container.getArchive({ path: filePath });
            
            return new Promise((resolve) => {
                let hasData = false;
                archive.on('data', (chunk) => {
                    if (chunk && chunk.length > 0) {
                        hasData = true;
                    }
                });
                archive.on('end', () => {
                    resolve(hasData);
                });
                archive.on('error', () => {
                    resolve(false);
                });
            });
        } catch (e) {
            return false;
        }
    }

    /**
     * ✅ ПРЯМОЕ ЧТЕНИЕ: Читает содержимое файла через Docker API
     */
    async readFile(vmName, filePath) {
        await this.ensureConnection();
        const container = this.docker.getContainer(vmName);
        
        try {
            // Получаем архив с файлом
            const archive = await container.getArchive({ path: filePath });
            
            return new Promise((resolve, reject) => {
                const chunks = [];
                
                archive.on('data', (chunk) => {
                    chunks.push(chunk);
                });
                
                archive.on('end', async () => {
                    try {
                        // Объединяем чанки
                        const buffer = Buffer.concat(chunks);
                        
                        // TAR-архив имеет 512-байтовый заголовок
                        // Пропускаем заголовок и получаем содержимое файла
                        const headerSize = 512;
                        // Выравниваем по 512 байт
                        const contentStart = headerSize;
                        const content = buffer.slice(contentStart).toString('utf8').trim();
                        
                        resolve(content);
                    } catch (parseErr) {
                        reject(parseErr);
                    }
                });
                
                archive.on('error', (err) => {
                    reject(err);
                });
            });
        } catch (e) {
            throw new Error(`Не удалось прочитать файл ${filePath}: ${e.message}`);
        }
    }

    /**
     * Получает список файлов в директории через Docker API
     */
    async listDirectory(vmName, dirPath) {
        await this.ensureConnection();
        try {
            // Используем ls через exec для списка файлов
            const result = await this.execCommand(vmName, `ls -la ${dirPath}`);
            return result;
        } catch (e) {
            throw new Error(`Не удалось получить список файлов: ${e.message}`);
        }
    }
    async getVMStatus(vmName) {
        await this.ensureConnection();
        
        try {
            const container = this.docker.getContainer(vmName);
            const info = await container.inspect();
            return info.State.Status.toLowerCase();
        } catch {
            return 'not_found';
        }
    }

    async startVM(vmName) {
        await this.ensureConnection();
        try {
            const container = this.docker.getContainer(vmName);
            await container.start();
            logger.success(`Контейнер ${vmName} запущен`);
        } catch (e) {
            if (e.message.includes('already started')) return;
            throw e;
        }
    }

    async stopVM(vmName) {
        await this.ensureConnection();
        
        try {
            const container = this.docker.getContainer(vmName);
            await container.stop();
            logger.info(`Контейнер ${vmName} остановлен`);
        } catch (e) {
            logger.warn(`Ошибка остановки: ${e.message}`);
        }
    }

    async restartVM(vmName) {
        await this.ensureConnection();
        try {
            const container = this.docker.getContainer(vmName);
            await container.restart();
            logger.info(`Контейнер ${vmName} перезапущен`);
        } catch (e) {
            logger.error(`Ошибка рестарта: ${e.message}`);
            throw e;
        }
    }

    async deleteVM(vmName) {
        await this.ensureConnection();
        
        try {
            const container = this.docker.getContainer(vmName);
            await container.stop().catch(() => {});
            await container.remove();
            logger.info(`Контейнер ${vmName} удален`);
        } catch (e) {
            logger.warn(`Ошибка удаления контейнера: ${e.message}`);
        }
        
        try {
            const volume = this.docker.getVolume(vmName);
            await volume.remove();
            logger.info(`Том ${vmName} удален`);
        } catch (e) {
            logger.warn(`Ошибка удаления тома: ${e.message}`);
        }
        
        logger.success(`ВМ ${vmName} полностью удалена`);
    }

    async getVMIP(vmName) {
        return '127.0.0.1';
    }

    async getLogs(vmName) {
        await this.ensureConnection();
        try {
            const container = this.docker.getContainer(vmName);
            const logs = await container.logs({
                stdout: true,
                stderr: true,
                tail: 200,
                timestamps: true
            });
            return logs.toString('utf8');
        } catch (e) {
            return `Ошибка получения логов: ${e.message}`;
        }
    }

    async updateContainerResources(vmName, ramMB, cpuCores) {
        await this.ensureConnection();
        try {
            const container = this.docker.getContainer(vmName);
            const updateConfig = {};
            
            if (ramMB) {
                updateConfig.Memory = ramMB * 1024 * 1024;
                updateConfig.MemorySwap = -1;
            }
            
            if (cpuCores) {
                updateConfig.NanoCpus = cpuCores * 1000000000;
            }

            await container.update(updateConfig);
            logger.success(`Ресурсы контейнера ${vmName} обновлены: RAM=${ramMB}MB, CPU=${cpuCores}`);
            return true;
        } catch (e) {
            logger.error(`Ошибка обновления ресурсов для ${vmName}:`, e.message);
            throw e;
        }
    }

    async createBackup(vmName, backupName) {
        await this.ensureConnection();
        try {
            const container = this.docker.getContainer(vmName);
            
            const data = await container.commit({
                repo: backupName,
                comment: `Backup of ${vmName} at ${new Date().toISOString()}`,
                author: 'IaaS Platform',
                pause: true 
            });
            
            logger.success(`Бекап (образ) создан: ${backupName} (${data.Id})`);
            return data.Id;
        } catch (e) {
            logger.error(`Ошибка создания бекапа для ${vmName}:`, e.message);
            throw e;
        }
    }

    async deleteBackup(imageName) {
        await this.ensureConnection();
        try {
            const image = this.docker.getImage(imageName);
            await image.remove();
            logger.success(`Бекап (образ) удален: ${imageName}`);
        } catch (e) {
            logger.warn(`Ошибка удаления бекапа ${imageName}:`, e.message);
        }
    }

    async createVolumeBackup(volumeName, backupPath) {
        await this.ensureConnection();
        
        try {
            const tempContainer = await this.docker.createContainer({
                Image: 'node:20',
                Cmd: ['sleep', '3600'],
                HostConfig: {
                    Mounts: [
                        {
                            Type: 'volume',
                            Source: volumeName,
                            Target: '/data',
                            ReadOnly: true
                        }
                    ]
                }
            });

            await tempContainer.start();
            const archive = await tempContainer.getArchive({ path: '/data' });
            const writeStream = require('fs').createWriteStream(backupPath);
            
            await new Promise((resolve, reject) => {
                archive.pipe(writeStream);
                archive.on('end', resolve);
                archive.on('error', reject);
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
            });

            await tempContainer.stop();
            await tempContainer.remove();

            logger.success(`Архив тома создан: ${backupPath}`);
            return true;
        } catch (error) {
            logger.error(`Ошибка создания архива тома: ${error.message}`);
            throw error;
        }
    }

    async restoreVolumeBackup(volumeName, backupPath) {
        await this.ensureConnection();
        
        try {
            const fs = require('fs');
            
            if (!fs.existsSync(backupPath)) {
                throw new Error(`Файл бекапа не найден: ${backupPath}`);
            }

            const tempContainer = await this.docker.createContainer({
                Image: 'node:20',
                Cmd: ['sleep', '3600'],
                HostConfig: {
                    Mounts: [
                        {
                            Type: 'volume',
                            Source: volumeName,
                            Target: '/data',
                            ReadOnly: false
                        }
                    ]
                }
            });

            await tempContainer.start();

            await tempContainer.putArchive(
                require('fs').createReadStream(backupPath),
                { path: '/data' }
            );

            await tempContainer.stop();
            await tempContainer.remove();

            logger.success(`Том восстановлен из: ${backupPath}`);
            return true;
        } catch (error) {
            logger.error(`Ошибка восстановления тома: ${error.message}`);
            throw error;
        }
    }

    async getStats(vmName) {
        await this.ensureConnection();
        try {
            const container = this.docker.getContainer(vmName);
            const stats = await container.stats({ stream: false });
            
            let cpuUsage = 0.0;
            
            if (stats.cpu_stats && stats.precpu_stats && stats.cpu_stats.cpu_usage && stats.precpu_stats.cpu_usage) {
                const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
                const systemCpuDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
                
                const numberCpus = stats.cpu_stats.online_cpus || 
                                 (stats.cpu_stats.cpu_usage.percpu_usage ? stats.cpu_stats.cpu_usage.percpu_usage.length : 1);

                if (systemCpuDelta > 0.0 && numberCpus > 0.0) {
                    cpuUsage = (cpuDelta / systemCpuDelta) * numberCpus * 100.0;
                }
            }

            let usedMemory = 0;
            if (stats.memory_stats && stats.memory_stats.usage) {
                usedMemory = stats.memory_stats.usage;
                if (stats.memory_stats.stats) {
                    if (typeof stats.memory_stats.stats.cache !== 'undefined') {
                        usedMemory -= stats.memory_stats.stats.cache;
                    } else if (typeof stats.memory_stats.stats.inactive_file !== 'undefined') {
                        usedMemory -= stats.memory_stats.stats.inactive_file;
                    }
                }
            }
            const memoryUsageMB = usedMemory / (1024 * 1024);

            return {
                cpu: isNaN(cpuUsage) ? 0 : parseFloat(cpuUsage.toFixed(2)),
                ram: isNaN(memoryUsageMB) ? 0 : parseFloat(memoryUsageMB.toFixed(2))
            };
        } catch (e) {
            return null;
        }
    }

    async volumeExists(volumeName) {
        await this.ensureConnection();
        try {
            await this.docker.getVolume(volumeName).inspect();
            return true;
        } catch {
            return false;
        }
    }

    async listVolumes() {
        await this.ensureConnection();
        const volumes = await this.docker.listVolumes();
        return volumes.Volumes || [];
    }
}

module.exports = new DockerService();