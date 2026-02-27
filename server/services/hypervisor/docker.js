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
        let cmd = ['sh', '-c', 'while :; do sleep 1; done'];
        let privileged = false;
        let env = [];

        if (vmConfig.type === 'k8s') {
            imageName = 'rancher/k3s:latest';
            cmd = ['server', '--disable-agent'];
            privileged = true;
            env = ['K3S_KUBECONFIG_OUTPUT=/output/kubeconfig.yaml', 'K3S_KUBECONFIG_MODE=666'];
        } else if (vmConfig.type === 'docker') {
            imageName = vmConfig.dockerImage || 'ubuntu:latest';
            if (imageName.includes('ubuntu') || imageName.includes('alpine') || imageName.includes('debian') || imageName.includes('centos')) {
                 cmd = ['sh', '-c', 'while :; do sleep 1; done'];
            } else {
                 cmd = undefined; 
            }
        } else {
            const frameworks = {
                'node': 'node:18',
                'python': 'python:3.10',
                'go': 'golang:1.21'
            };
            imageName = frameworks[vmConfig.framework] || 'node:18';
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

    async getStats(vmName) {
        await this.ensureConnection();
        try {
            const container = this.docker.getContainer(vmName);
            const stats = await container.stats({ stream: false });
            
            // Calculate CPU usage
            let cpuUsage = 0.0;
            const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
            const systemCpuDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
            const numberCpus = stats.cpu_stats.online_cpus;

            if (systemCpuDelta > 0.0 && numberCpus > 0.0) {
                cpuUsage = (cpuDelta / systemCpuDelta) * numberCpus * 100.0;
            }

            // Calculate Memory usage
            let usedMemory = 0;
            if (stats.memory_stats && stats.memory_stats.usage) {
                usedMemory = stats.memory_stats.usage;
                if (stats.memory_stats.stats && stats.memory_stats.stats.cache) {
                    usedMemory -= stats.memory_stats.stats.cache;
                }
            }
            const memoryUsageMB = usedMemory / (1024 * 1024);

            return {
                cpu: isNaN(cpuUsage) ? 0 : cpuUsage,
                ram: isNaN(memoryUsageMB) ? 0 : memoryUsageMB
            };
        } catch (e) {
            return null;
        }
    }
}

module.exports = new DockerService();