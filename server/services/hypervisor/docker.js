// server/services/hypervisor/docker.js
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

    // ✅ Гарантируем инициализацию перед каждым вызовом
    async ensureConnection() {
        if (!this.connected || !this.docker) {
            await this.checkConnection();
        }
        if (!this.docker) {
            throw new Error('Docker не подключен. Проверьте, что /var/run/docker.sock доступен.');
        }
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
        
        const diskPath = path.join(config.VM_STORAGE_DIR || '/tmp/vms', vmName);
        
        if (!fs.existsSync(diskPath)) {
            fs.mkdirSync(diskPath, { recursive: true, mode: 0o777 });
            logger.info(`Директория создана: ${diskPath}`);
        }
        
        return diskPath;
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
        let cmd = undefined;
        let privileged = false;
        let env = [];

        if (vmConfig.type === 'k8s') {
            imageName = 'rancher/k3s:latest';
            cmd = ['server', '--disable-agent'];
            privileged = true;
            env = ['K3S_KUBECONFIG_OUTPUT=/output/kubeconfig.yaml', 'K3S_KUBECONFIG_MODE=666'];
        } else if (vmConfig.type === 'app') {
            // App VMs always need to stay alive for manual start
            cmd = ['sh', '-c', 'while :; do sleep 1; done'];
            if (vmConfig.dockerImage) {
                imageName = vmConfig.dockerImage;
            } else {
                const frameworks = {
                    'node': 'node:18',
                    'python': 'python:3.10',
                    'go': 'golang:1.21'
                };
                imageName = frameworks[vmConfig.framework] || 'node:18';
            }
        } else {
            // Docker type
            if (vmConfig.dockerImage) {
                imageName = vmConfig.dockerImage;
                // Only override CMD if it looks like a base OS image that would exit immediately
                if (imageName.match(/^(ubuntu|alpine|debian|centos)(:|$)/)) {
                    cmd = ['sh', '-c', 'while :; do sleep 1; done'];
                }
            } else {
                imageName = 'ubuntu:latest';
                cmd = ['sh', '-c', 'while :; do sleep 1; done'];
            }
        }
        
        // Проверяем и скачиваем образ через API
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

        const absoluteDiskPath = path.resolve(vmConfig.diskPath);
        
        // Проверка пути перед монтированием
        if (!fs.existsSync(absoluteDiskPath)) {
            fs.mkdirSync(absoluteDiskPath, { recursive: true, mode: 0o777 });
        }

        const container = await this.docker.createContainer({
            Image: imageName,
            name: vmConfig.name,
            Cmd: cmd,
            Env: env,
            Tty: true, // Включаем TTY для корректного отображения логов
            HostConfig: {
                PortBindings: {
                    '3000/tcp': [{ HostPort: String(vmConfig.hostPort) }],
                    // For K3s, we might need to expose 6443
                    ...(vmConfig.type === 'k8s' ? { '6443/tcp': [{ HostPort: String(vmConfig.hostPort + 10000) }] } : {})
                },
                Binds: [`${absoluteDiskPath}:/app`],
                Privileged: privileged,
                RestartPolicy: {
                    Name: 'unless-stopped'
                },
                // Set resource limits if provided
                ...(vmConfig.ram ? { Memory: vmConfig.ram * 1024 * 1024 } : {}),
                ...(vmConfig.cpu ? { NanoCpus: vmConfig.cpu * 1000000000 } : {}),
                LogConfig: {
                    Type: 'json-file',
                    Config: {
                        'max-size': '10m',
                        'max-file': '3'
                    }
                }
            },
            WorkingDir: '/app'
        });

        await container.start();
        logger.success(`Контейнер ${vmConfig.name} запущен`);
        return true;
    }

    async execCommand(vmName, cmd) {
        await this.ensureConnection();
        const container = this.docker.getContainer(vmName);
        
        const exec = await container.exec({
            Cmd: ['sh', '-c', cmd],
            AttachStdout: true,
            AttachStderr: true
        });

        const stream = await exec.start({ hijack: true, stdin: true });
        
        return new Promise((resolve, reject) => {
            let output = '';
            container.modem.demuxStream(stream, process.stdout, process.stderr);
            stream.on('data', chunk => output += chunk.toString());
            stream.on('end', () => resolve(output));
            stream.on('error', err => reject(err));
        });
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
            // Ignore if already started
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

    async deleteVM(vmName) {
        await this.ensureConnection();
        
        try {
            const container = this.docker.getContainer(vmName);
            await container.stop().catch(() => {});
            await container.remove();
        } catch (e) {
            logger.warn(`Ошибка удаления: ${e.message}`);
        }
        
        const diskPath = path.join(config.VM_STORAGE_DIR || '/tmp/vms', vmName);
        if (fs.existsSync(diskPath)) {
            fs.rmSync(diskPath, { recursive: true, force: true });
        }
        
        logger.success(`Контейнер ${vmName} удален`);
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
                tail: 100,
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
                updateConfig.MemorySwap = -1; // Unlimited swap or match memory
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
            
            // Commit the container to a new image
            // pause: true ensures the container is paused during commit for consistency
            const data = await container.commit({
                repo: backupName,
                comment: `Backup of ${vmName} at ${new Date().toISOString()}`,
                author: 'IaaS Platform',
                pause: true 
            });
            
            logger.success(`Бекап (образ) создан: ${backupName} (${data.Id})`);
            return data.Id; // Return the Image ID
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
            // Don't throw if it doesn't exist
        }
    }

    async getStats(vmName) {
        await this.ensureConnection();
        try {
            const container = this.docker.getContainer(vmName);
            const stats = await container.stats({ stream: false });
            
            // Calculate CPU usage
            let cpuUsage = 0.0;
            
            // Проверяем наличие статистики процессора
            if (stats.cpu_stats && stats.precpu_stats && stats.cpu_stats.cpu_usage && stats.precpu_stats.cpu_usage) {
                const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
                const systemCpuDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
                
                // Fallback если online_cpus отсутствует
                const numberCpus = stats.cpu_stats.online_cpus || 
                                 (stats.cpu_stats.cpu_usage.percpu_usage ? stats.cpu_stats.cpu_usage.percpu_usage.length : 1);

                if (systemCpuDelta > 0.0 && numberCpus > 0.0) {
                    cpuUsage = (cpuDelta / systemCpuDelta) * numberCpus * 100.0;
                }
            }

            // Calculate Memory usage
            let usedMemory = 0;
            if (stats.memory_stats && stats.memory_stats.usage) {
                usedMemory = stats.memory_stats.usage;
                // Вычитаем кэш, как это делает docker stats
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
            // logger.error(`Ошибка получения статистики для ${vmName}:`, e.message);
            return null;
        }
    }
}

module.exports = new DockerService();