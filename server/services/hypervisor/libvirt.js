// server/services/libvirt.js
const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const execAsync = promisify(exec);
const config = require('../../config');
const logger = require('../../utils/logger');

class LibvirtService {
    constructor() {
        this.connected = false;
        this.libvirtUri = config.LIBVIRT_URI || 'qemu:///system';
    }

    async ensureConnection() {
        if (!this.connected) {
            await this.checkConnection();
        }
        if (!this.connected) {
            throw new Error('Libvirt не подключен. Проверьте, что libvirtd запущен и доступен.');
        }
        return true;
    }

    async checkConnection() {
        try {
            await execAsync(`virsh --connect ${this.libvirtUri} list --all`);
            this.connected = true;
            logger.success('Подключено к libvirt');
            return true;
        } catch (err) {
            logger.error('Libvirt API недоступен', err.message);
            this.connected = false;
            return false;
        }
    }

    async runCommand(cmd, timeout = 30000) {
        await this.ensureConnection();
        return new Promise((resolve, reject) => {
            exec(`virsh --connect ${this.libvirtUri} ${cmd}`, { timeout }, (err, stdout, stderr) => {
                if (err) reject(new Error(stderr || err.message));
                else resolve(stdout.trim());
            });
        });
    }

    async createDisk(vmName, sizeGB) {
        await this.ensureConnection();
        const diskPath = path.join(config.VM_STORAGE_DIR || '/var/lib/libvirt/images', `${vmName}.qcow2`);
        
        // Проверяем существование диска
        if (fs.existsSync(diskPath)) {
            logger.info(`Диск ${diskPath} уже существует`);
            return diskPath;
        }

        // Создаём директорию если нужно
        const dir = path.dirname(diskPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Создаём qcow2 образ
        await execAsync(`qemu-img create -f qcow2 "${diskPath}" ${sizeGB}G`);
        
        // Устанавливаем метаданные через extended attributes если поддерживается
        try {
            execSync(`setfattr -n user.iaas.vm -v "${vmName}" "${diskPath}" 2>/dev/null || true`);
            execSync(`setfattr -n user.iaas.created -v "${new Date().toISOString()}" "${diskPath}" 2>/dev/null || true`);
        } catch (e) {
            // Игнорируем если xattr не поддерживается
        }
        
        logger.info(`Диск создан: ${diskPath}`);
        return diskPath;
    }

    async runGuestCommand(vmName, cmd, timeout = 300000) {
        // Попытка через qemu-guest-agent (предпочтительно)
        try {
            const result = await this.runCommand(
                `guest-exec --domain ${vmName} --command "/bin/sh" --arg "-c" --arg "${cmd.replace(/"/g, '\\"')}"`,
                timeout
            );
            // Получаем вывод через guest-exec-status
            const pidMatch = result.match(/pid:\s*(\d+)/);
            if (pidMatch) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                const status = await this.runCommand(`guest-exec-status --domain ${vmName} --pid ${pidMatch[1]}`);
                return status;
            }
            return result;
        } catch (e) {
            // Fallback: через libguestfs (требует установленного libguestfs-tools)
            try {
                const { stdout } = await execAsync(
                    `virt-run --ro -d ${vmName} --run 'echo "${cmd.replace(/"/g, '\\"')}" | sh' 2>/dev/null`,
                    { timeout }
                );
                return stdout.trim();
            } catch (guestErr) {
                // Final fallback: через SSH если настроен
                throw new Error(`Не удалось выполнить команду в ВМ: ${e.message}`);
            }
        }
    }

    async createVM(vmConfig) {
        await this.ensureConnection();
        
        // Подготовка параметров
        const vmName = vmConfig.name;
        const ram = vmConfig.ram || 1024;
        const cpu = vmConfig.cpu || 1;
        const diskPath = vmConfig.diskPath || await this.createDisk(vmName, vmConfig.diskSize || 20);
        const network = vmConfig.network || 'default';
        const hostPort = vmConfig.hostPort || 3000;
        
        // cloud-init iso должен быть сгенерирован заранее и передан
        const cloudInitIso = vmConfig.cloudInitIso;
        if (!cloudInitIso) {
            throw new Error('cloudInitIso не предоставлен для создания ВМ');
        }
        
        // Генерация XML конфигурации
        const xml = this._generateVMXml({
            ...vmConfig,
            diskPath,
            cloudInitIso,
            ram,
            cpu,
            network,
            hostPort
        });
        
        const xmlPath = path.join('/tmp', `${vmName}.xml`);
        fs.writeFileSync(xmlPath, xml);
        
        try {
            // Определяем VM
            await this.runCommand(`define ${xmlPath}`);
            
            // Запускаем VM
            await this.runCommand(`start ${vmName}`);
            
            // Ждём пока VM запустится
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            logger.success(`ВМ ${vmName} запущена`);
            return true;
        } finally {
            // Удаляем временный XML
            if (fs.existsSync(xmlPath)) fs.unlinkSync(xmlPath);
        }
    }


    _generateVMXml(config) {
        const diskBus = config.diskBus || 'virtio';
        const networkModel = config.networkModel || 'virtio';
        
        // Порт для VNC (auto)
        const vncPort = config.vncPort || -1;
        
        // QEMU аргменты для проброса портов
        const portRedirection = config.hostPort 
            ? `<qemu:arg value='-redir'/>
      <qemu:arg value='tcp:${config.hostPort}::3000'/>` 
            : '';
        
        const k3sExtra = config.type === 'k8s' 
            ? `<qemu:arg value='-cpu'/>
      <qemu:arg value='host'/>
      <qemu:arg value='-append'/>
      <qemu:arg value='cgroup_enable=cpuset cgroup_memory=1 systemd.unified_cgroup_hierarchy=0'/>` 
            : '';

        return `<?xml version='1.0' encoding='UTF-8'?>
<domain type='kvm' xmlns:qemu='http://libvirt.org/schemas/domain/qemu/1.0'>
  <name>${config.name}</name>
  <memory unit='MiB'>${config.ram}</memory>
  <vcpu placement='static'>${config.cpu}</vcpu>
  <os>
    <type arch='x86_64' machine='pc-q35-5.2'>hvm</type>
    <boot dev='hd'/>
  </os>
  <features>
    <acpi/>
    <apic/>
    <vmport state='off'/>
  </features>
  <cpu mode='host-passthrough' check='none' migratable='on'>
    <feature policy='require' name='topoext'/>
  </cpu>
  <clock offset='utc'>
    <timer name='rtc' tickpolicy='catchup'/>
    <timer name='pit' tickpolicy='delay'/>
    <timer name='hpet' present='no'/>
  </clock>
  <on_poweroff>destroy</on_poweroff>
  <on_reboot>restart</on_reboot>
  <on_crash>destroy</on_crash>
  <pm>
    <suspend-to-mem enabled='no'/>
    <suspend-to-disk enabled='no'/>
  </pm>
  <devices>
    <emulator>/usr/bin/qemu-system-x86_64</emulator>
    
    <!-- Disk -->
    <disk type='file' device='disk'>
      <driver name='qemu' type='qcow2' cache='none' discard='unmap'/>
      <source file='${config.diskPath}'/>
      <target dev='vda' bus='${diskBus}'/>
      <address type='pci' domain='0x0000' bus='0x04' slot='0x00' function='0x0'/>
    </disk>
    
    <!-- Cloud-init CDROM -->
    <disk type='file' device='cdrom'>
      <driver name='qemu' type='raw'/>
      <source file='${config.cloudInitIso}'/>
      <target dev='sdb' bus='sata'/>
      <readonly/>
      <address type='drive' controller='0' bus='0' target='0' unit='1'/>
    </disk>
    
    <!-- Network -->
    <interface type='network'>
      <source network='${config.network}'/>
      <model type='${networkModel}'/>
      <address type='pci' domain='0x0000' bus='0x01' slot='0x00' function='0x0'/>
    </interface>
    
    <!-- Console -->
    <console type='pty'>
      <target type='serial' port='0'/>
    </console>
    <channel type='unix'>
      <target type='virtio' name='org.qemu.guest_agent.0'/>
      <address type='virtio-serial' controller='0' bus='0' port='1'/>
    </channel>
    
    <!-- Port forwarding -->
    ${portRedirection}
    
    <!-- K8s extra -->
    ${k3sExtra}
    
    <!-- Graphics -->
    <graphics type='vnc' port='${vncPort}' autoport='yes' listen='127.0.0.1'>
      <listen type='address' address='127.0.0.1'/>
    </graphics>
    <video>
      <model type='qxl' ram='65536' vram='65536' vgamem='16384' heads='1' primary='yes'/>
      <address type='pci' domain='0x0000' bus='0x00' slot='0x02' function='0x0'/>
    </video>
    <input type='tablet' bus='usb'>
      <address type='usb' bus='0' port='1'/>
    </input>
    <input type='mouse' bus='ps2'/>
    <input type='keyboard' bus='ps2'/>
    
    <!-- RNG for better entropy -->
    <rng model='virtio'>
      <backend model='random'>/dev/urandom</backend>
      <address type='pci' domain='0x0000' bus='0x05' slot='0x00' function='0x0'/>
    </rng>
  </devices>
</domain>`;
    }

    // ✅ Обновление команды запуска (через cloud-init или скрипт)
    async updateContainerCommand(vmName, newCmd) {
        await this.ensureConnection();
        
        // Для libvirt "команда" — это обычно скрипт автозапуска
        // Сохраняем в metadata или создаём скрипт в ВМ
        const scriptPath = '/usr/local/bin/entrypoint.sh';
        const scriptContent = `#!/bin/bash
${Array.isArray(newCmd) ? newCmd.join(' ') : newCmd}
`;
        
        try {
            // Пытаемся записать скрипт через virt-copy-in (требует libguestfs)
            const tempScript = `/tmp/${vmName}-entrypoint.sh`;
            fs.writeFileSync(tempScript, scriptContent, { mode: 0o755 });
            
            await execAsync(`virt-copy-in -d ${vmName} "${tempScript}" "${scriptPath}"`);
            fs.unlinkSync(tempScript);
            
            // Обновляем cloud-init для следующего запуска
            await this._updateCloudInitCmd(vmName, newCmd);
            
            logger.info(`Команда ВМ ${vmName} обновлена`);
            return true;
        } catch (e) {
            logger.warn(`Не удалось обновить команду через virt-copy-in: ${e.message}`);
            // Сохраняем в XML metadata как fallback
            await this._updateVmMetadata(vmName, { entrypoint: newCmd });
            return true;
        }
    }

    async _updateCloudInitCmd(vmName, newCmd) {
        // Обновляем user-data в cloud-init iso
        const isoPath = path.join(config.ISO_DIR || '/var/lib/libvirt/cloud-init', `${vmName}-cidata.iso`);
        if (!fs.existsSync(isoPath)) return;
        
        const tempDir = `/tmp/ci-${vmName}-${Date.now()}`;
        fs.mkdirSync(tempDir, { recursive: true });
        
        try {
            // Монтируем ISO (требует fuse)
            await execAsync(`guestmount -a "${isoPath}" -m /dev/sda1 "${tempDir}"`);
            
            const userDataPath = path.join(tempDir, 'user-data');
            let userData = fs.readFileSync(userDataPath, 'utf8');
            
            // Добавляем runcmd если нет
            if (!userData.includes('runcmd:')) {
                userData += `\nruncmd:\n`;
            }
            const cmdStr = Array.isArray(newCmd) ? newCmd.join(' ') : newCmd;
            userData += `  - [ sh, -c, "${cmdStr}" ]\n`;
            
            fs.writeFileSync(userDataPath, userData);
            await execAsync(`guestunmount "${tempDir}"`);
        } catch (e) {
            logger.warn(`Не удалось обновить cloud-init: ${e.message}`);
        } finally {
            // Cleanup
            try { execSync(`rm -rf "${tempDir}"`); } catch {}
        }
    }

    async _updateVmMetadata(vmName, metadata) {
        try {
            const current = await this.runCommand(`dumpxml ${vmName}`);
            // Добавляем metadata в XML (упрощённо)
            const metadataXml = `<metadata xmlns:iaas="http://example.com/iaas">
  <iaas:config>${JSON.stringify(metadata)}</iaas:config>
</metadata>`;
            // В реальности нужно правильно вставить в XML через virsh metadata
            await execAsync(`virsh metadata ${vmName} --uri ${this.libvirtUri} --set "${JSON.stringify(metadata)}" || true`);
        } catch (e) {
            logger.debug(`Не удалось обновить metadata: ${e.message}`);
        }
    }

    // ✅ Выполнение команды внутри ВМ
    async execCommand(vmName, cmd, timeout = 300000) {
        await this.ensureConnection();
        
        // Метод 1: qemu-guest-agent (если установлен в госте)
        try {
            const result = await this._execViaGuestAgent(vmName, cmd, timeout);
            if (result !== null) return result;
        } catch (e) {
            logger.debug(`Guest-agent не ответил: ${e.message}`);
        }
        
        // Метод 2: libguestfs/virt-run (для оффлайн или если агент не работает)
        try {
            return await this._execViaLibGuestFs(vmName, cmd, timeout);
        } catch (e) {
            logger.debug(`Libguestfs не сработал: ${e.message}`);
        }
        
        // Метод 3: SSH (если настроен и известен IP)
        try {
            const ip = await this.getVMIP(vmName);
            if (ip && ip !== '127.0.0.1') {
                return await this._execViaSsh(ip, cmd, timeout);
            }
        } catch (e) {
            logger.debug(`SSH не сработал: ${e.message}`);
        }
        
        throw new Error(`Не удалось выполнить команду в ВМ ${vmName}. Проверьте наличие qemu-guest-agent или SSH доступа.`);
    }

    async _execViaGuestAgent(vmName, cmd, timeout) {
        // Guest-exec через virsh
        const execResult = await this.runCommand(
            `guest-exec --domain "${vmName}" --command "/bin/sh" --arg "-c" --arg "${cmd.replace(/"/g, '\\"')}"`
        );
        
        const pidMatch = execResult.match(/pid:\s*(\d+)/);
        if (!pidMatch) return null;
        
        // Ждём выполнения с таймаутом
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            const status = await this.runCommand(`guest-exec-status --domain "${vmName}" --pid ${pidMatch[1]}`);
            
            if (status.includes('exited')) {
                // Парсим вывод (упрощённо)
                const exitCode = status.match(/exit code:\s*(\d+)/)?.[1] || '0';
                if (exitCode !== '0') {
                    throw new Error(`Command failed with code ${exitCode}`);
                }
                // Возвращаем stdout (в реальности нужно парсить правильно)
                return status;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        throw new Error(`Timeout executing command: ${cmd}`);
    }

    async _execViaLibGuestFs(vmName, cmd, timeout) {
        // Используем virt-run для выполнения в запущенной ВМ
        // Примечание: virt-run работает только с остановленными ВМ или через special mode
        const { stdout } = await execAsync(
            `echo "${cmd.replace(/"/g, '\\"')}" | virt-cat -d "${vmName}" - 2>/dev/null || ` +
            `virt-chroot -a -d "${vmName}" --run "${cmd}" 2>/dev/null`,
            { timeout }
        );
        return stdout?.trim() || '';
    }

    async _execViaSsh(ip, cmd, timeout, user = 'vmuser') {
        const keyPath = config.SSH_PRIVATE_KEY || path.join(process.env.HOME || '', '.ssh', 'id_rsa');
        const { stdout } = await execAsync(
            `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -i "${keyPath}" ${user}@${ip} "${cmd.replace(/"/g, '\\"')}"`,
            { timeout }
        );
        return stdout.trim();
    }

    // ✅ Проверка существования файла
    async fileExists(vmName, filePath) {
        await this.ensureConnection();
        try {
            // Через libguestfs
            await execAsync(`virt-ls -d "${vmName}" "${filePath}" 2>/dev/null`);
            return true;
        } catch {
            // Через guest-agent если доступен
            try {
                const result = await this._execViaGuestAgent(vmName, `test -f "${filePath}" && echo exists`, 10000);
                return result?.includes('exists') || false;
            } catch {
                return false;
            }
        }
    }

    // ✅ Чтение файла
    async readFile(vmName, filePath) {
        await this.ensureConnection();
        try {
            // Через virt-cat (libguestfs)
            const { stdout } = await execAsync(`virt-cat -d "${vmName}" "${filePath}" 2>/dev/null`);
            return stdout.trim();
        } catch (e) {
            // Fallback через guest-agent
            try {
                return await this._execViaGuestAgent(vmName, `cat "${filePath}"`, 30000);
            } catch {
                throw new Error(`Не удалось прочитать файл ${filePath}: ${e.message}`);
            }
        }
    }

    // ✅ Список файлов в директории
    async listDirectory(vmName, dirPath) {
        await this.ensureConnection();
        try {
            const { stdout } = await execAsync(`virt-ls -lR -d "${vmName}" "${dirPath}" 2>/dev/null`);
            return stdout.trim();
        } catch (e) {
            // Fallback через exec
            return await this.execCommand(vmName, `ls -la "${dirPath}"`, 30000);
        }
    }

    // ✅ Статус ВМ
    async getVMStatus(vmName) {
        await this.ensureConnection();
        try {
            const state = await this.runCommand(`domstate "${vmName}"`);
            return state.toLowerCase().trim();
        } catch {
            return 'not_found';
        }
    }

    // ✅ Запуск ВМ
    async startVM(vmName) {
        await this.ensureConnection();
        try {
            const status = await this.getVMStatus(vmName);
            if (status === 'running') return;
            if (status === 'not_found') throw new Error(`VM ${vmName} not found`);
            
            await this.runCommand(`start "${vmName}"`);
            // Ждём пока запустится
            await new Promise(resolve => setTimeout(resolve, 2000));
            logger.success(`ВМ ${vmName} запущена`);
        } catch (e) {
            if (e.message.includes('already running')) return;
            throw e;
        }
    }

    // ✅ Остановка ВМ
    async stopVM(vmName) {
        await this.ensureConnection();
        try {
            // Graceful shutdown через guest-agent
            try {
                await this.runCommand(`guest-shutdown --domain "${vmName}" --mode poweroff`);
                // Ждём остановки до 60 сек
                for (let i = 0; i < 12; i++) {
                    if (await this.getVMStatus(vmName) === 'shut off') break;
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            } catch {
                // Force stop
                await this.runCommand(`destroy "${vmName}"`);
            }
            logger.info(`ВМ ${vmName} остановлена`);
        } catch (e) {
            logger.warn(`Ошибка остановки: ${e.message}`);
        }
    }

    // ✅ Перезапуск ВМ
    async restartVM(vmName) {
        await this.ensureConnection();
        try {
            await this.stopVM(vmName);
            await new Promise(resolve => setTimeout(resolve, 2000));
            await this.startVM(vmName);
            logger.info(`ВМ ${vmName} перезапущена`);
        } catch (e) {
            logger.error(`Ошибка рестарта: ${e.message}`);
            throw e;
        }
    }

    // ✅ Удаление ВМ
    async deleteVM(vmName) {
        await this.ensureConnection();
        
        // Останавливаем и удаляем домен
        try {
            await this.runCommand(`destroy "${vmName}"`).catch(() => {});
            await this.runCommand(`undefine "${vmName}" --remove-all-storage --snapshots-metadata`).catch(() => {
                // Fallback для старых версий virsh
                return this.runCommand(`undefine "${vmName}"`);
            });
            logger.info(`Контейнер ${vmName} удален`);
        } catch (e) {
            logger.warn(`Ошибка удаления домена: ${e.message}`);
        }
        
        // Удаляем диск
        const diskPath = path.join(config.VM_STORAGE_DIR || '/var/lib/libvirt/images', `${vmName}.qcow2`);
        try {
            if (fs.existsSync(diskPath)) {
                fs.unlinkSync(diskPath);
                logger.info(`Диск ${diskPath} удален`);
            }
        } catch (e) {
            logger.warn(`Ошибка удаления диска: ${e.message}`);
        }
        
        // Удаляем cloud-init iso
        const isoPath = path.join(config.ISO_DIR || '/var/lib/libvirt/cloud-init', `${vmName}-cidata.iso`);
        try {
            if (fs.existsSync(isoPath)) fs.unlinkSync(isoPath);
        } catch (e) {
            logger.warn(`Ошибка удаления ISO: ${e.message}`);
        }
        
        logger.success(`ВМ ${vmName} полностью удалена`);
    }

    // ✅ IP адрес ВМ
    async getVMIP(vmName) {
        await this.ensureConnection();
        try {
            // Через virsh net-dhcp-leases
            const leases = await this.runCommand('net-dhcp-leases default');
            const lines = leases.split('\n').slice(2); // Пропускаем заголовок
            
            for (const line of lines) {
                if (line.includes(vmName) || line.toLowerCase().includes(vmName.toLowerCase())) {
                    const ipMatch = line.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
                    if (ipMatch) return ipMatch[0];
                }
            }
            
            // Fallback: через guest-agent если доступен
            try {
                const ip = await this._execViaGuestAgent(vmName, "hostname -I | awk '{print $1}'", 10000);
                if (ip && ip.match(/^\d+\.\d+\.\d+\.\d+$/)) return ip.trim();
            } catch {}
            
        } catch (e) {
            logger.debug(`Не удалось получить IP: ${e.message}`);
        }
        return '127.0.0.1';
    }

    // ✅ Логи ВМ
    async getLogs(vmName) {
        await this.ensureConnection();
        try {
            // Через virsh console (может требовать интерактивности)
            // Альтернатива: логи libvirt
            const logPath = `/var/log/libvirt/qemu/${vmName}.log`;
            if (fs.existsSync(logPath)) {
                const logs = fs.readFileSync(logPath, 'utf8');
                // Возвращаем последние 200 строк
                return logs.split('\n').slice(-200).join('\n');
            }
            
            // Fallback: через journalctl внутри ВМ если доступен
            try {
                return await this.execCommand(vmName, 'journalctl -n 200 --no-pager 2>/dev/null || dmesg | tail -200', 30000);
            } catch {}
            
            return 'Логи недоступны';
        } catch (e) {
            return `Ошибка получения логов: ${e.message}`;
        }
    }

    // ✅ Обновление ресурсов ВМ
    async updateContainerResources(vmName, ramMB, cpuCores) {
        await this.ensureConnection();
        
        // Примечание: hot-plug памяти/CPU требует поддержки гостем
        const updates = [];
        if (ramMB) updates.push(`<memory unit='MiB'>${ramMB}</memory>`);
        if (cpuCores) updates.push(`<vcpu placement='static'>${cpuCores}</vcpu>`);
        
        if (updates.length === 0) return true;
        
        try {
            // Для изменения ресурсов нужно перезапустить ВМ с новым XML
            // 1. Сохраняем текущий XML
            const xml = await this.runCommand(`dumpxml "${vmName}"`);
            
            // 2. Модифицируем (упрощённо через replace)
            let newXml = xml;
            if (ramMB) {
                newXml = newXml.replace(/<memory unit='MiB'>\d+<\/memory>/, `<memory unit='MiB'>${ramMB}</memory>`);
            }
            if (cpuCores) {
                newXml = newXml.replace(/<vcpu[^>]*>\d+<\/vcpu>/, `<vcpu placement='static'>${cpuCores}</vcpu>`);
            }
            
            // 3. Если ВМ запущена - останавливаем, обновляем, запускаем
            const wasRunning = await this.getVMStatus(vmName) === 'running';
            if (wasRunning) await this.stopVM(vmName);
            
            // 4. Обновляем определение
            const xmlPath = `/tmp/${vmName}-updated.xml`;
            fs.writeFileSync(xmlPath, newXml);
            await this.runCommand(`define "${xmlPath}"`);
            fs.unlinkSync(xmlPath);
            
            if (wasRunning) await this.startVM(vmName);
            
            logger.success(`Ресурсы ВМ ${vmName} обновлены: RAM=${ramMB}MB, CPU=${cpuCores}`);
            return true;
        } catch (e) {
            logger.error(`Ошибка обновления ресурсов для ${vmName}:`, e.message);
            throw e;
        }
    }

    // ✅ Создание бэкапа (snapshot ВМ)
    async createBackup(vmName, backupName) {
        await this.ensureConnection();
        
        try {
            // Создаём snapshot диска через qemu-img
            const diskPath = path.join(config.VM_STORAGE_DIR || '/var/lib/libvirt/images', `${vmName}.qcow2`);
            const backupPath = path.join(config.BACKUP_DIR || '/var/lib/libvirt/backups', `${backupName}.qcow2`);
            
            const backupDir = path.dirname(backupPath);
            if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
            
            // Создаём бэкап через qemu-img convert (консистентный если ВМ остановлена)
            const status = await this.getVMStatus(vmName);
            if (status === 'running') {
                // Для running VM используем --force-share или предварительно создаём snapshot
                await execAsync(`qemu-img convert -f qcow2 -O qcow2 -c "${diskPath}" "${backupPath}"`);
            } else {
                await execAsync(`qemu-img convert -f qcow2 -O qcow2 -c "${diskPath}" "${backupPath}"`);
            }
            
            // Сохраняем metadata бэкапа
            const metaPath = backupPath + '.meta.json';
            fs.writeFileSync(metaPath, JSON.stringify({
                source: vmName,
                backupName,
                createdAt: new Date().toISOString(),
                diskSize: fs.statSync(diskPath).size
            }, null, 2));
            
            logger.success(`Бекап создан: ${backupName} (${backupPath})`);
            return backupPath;
        } catch (e) {
            logger.error(`Ошибка создания бекапа для ${vmName}:`, e.message);
            throw e;
        }
    }

    // ✅ Удаление бэкапа
    async deleteBackup(backupName) {
        await this.ensureConnection();
        
        const backupDir = config.BACKUP_DIR || '/var/lib/libvirt/backups';
        const backupPath = path.join(backupDir, `${backupName}.qcow2`);
        const metaPath = backupPath + '.meta.json';
        
        try {
            if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
            if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
            logger.success(`Бекап удален: ${backupName}`);
        } catch (e) {
            logger.warn(`Ошибка удаления бекапа ${backupName}:`, e.message);
        }
    }

    // ✅ Бэкап тома (диска)
    async createVolumeBackup(volumeName, backupPath) {
        await this.ensureConnection();
        
        // volumeName = имя диска/ВМ
        const diskPath = path.join(config.VM_STORAGE_DIR || '/var/lib/libvirt/images', `${volumeName}.qcow2`);
        
        if (!fs.existsSync(diskPath)) {
            throw new Error(`Диск не найден: ${diskPath}`);
        }
        
        const backupDir = path.dirname(backupPath);
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        
        try {
            // Создаём сжатый бэкап
            await execAsync(`qemu-img convert -f qcow2 -O qcow2 -c "${diskPath}" "${backupPath}"`);
            logger.success(`Архив тома создан: ${backupPath}`);
            return true;
        } catch (error) {
            logger.error(`Ошибка создания архива тома: ${error.message}`);
            throw error;
        }
    }

    // ✅ Восстановление тома из бэкапа
    async restoreVolumeBackup(volumeName, backupPath) {
        await this.ensureConnection();
        
        if (!fs.existsSync(backupPath)) {
            throw new Error(`Файл бекапа не найден: ${backupPath}`);
        }
        
        const diskPath = path.join(config.VM_STORAGE_DIR || '/var/lib/libvirt/images', `${volumeName}.qcow2`);
        const diskDir = path.dirname(diskPath);
        if (!fs.existsSync(diskDir)) fs.mkdirSync(diskDir, { recursive: true });
        
        try {
            // Проверяем что ВМ не запущена
            const status = await this.getVMStatus(volumeName);
            if (status === 'running') {
                throw new Error(`Невозможно восстановить диск запущенной ВМ. Остановите ${volumeName} сначала.`);
            }
            
            // Восстанавливаем диск
            await execAsync(`qemu-img convert -f qcow2 -O qcow2 "${backupPath}" "${diskPath}"`);
            
            logger.success(`Том восстановлен из: ${backupPath}`);
            return true;
        } catch (error) {
            logger.error(`Ошибка восстановления тома: ${error.message}`);
            throw error;
        }
    }

    // ✅ Статистика использования ресурсов
    async getStats(vmName) {
        await this.ensureConnection();
        
        try {
            // Через virsh domstats
            const stats = await this.runCommand(`domstats "${vmName}" --balloon --cpu --vcpu --block --state`);
            
            const result = { cpu: 0, ram: 0 };
            
            // Парсим вывод domstats
            const lines = stats.split('\n');
            let cpuTotal = 0, cpuTime = 0;
            
            for (const line of lines) {
                if (line.includes('cpu.time=')) {
                    const match = line.match(/cpu\.time=(\d+)/);
                    if (match) cpuTime = parseInt(match[1], 10);
                }
                if (line.includes('balloon.current=')) {
                    const match = line.match(/balloon\.current=(\d+)/);
                    if (match) result.ram = Math.round(parseInt(match[1], 10) / (1024 * 1024)); // bytes to MB
                }
                if (line.includes('state.state=')) {
                    // Можно добавить статус
                }
            }
            
            // Для CPU нужно сравнивать с предыдущим значением (упрощённо возвращаем 0)
            // В продакшене стоит кешировать предыдущие значения
            
            return {
                cpu: result.cpu,
                ram: result.ram || 0
            };
        } catch (e) {
            logger.debug(`Не удалось получить статистику: ${e.message}`);
            return null;
        }
    }

    // ✅ Проверка существования тома (диска)
    async volumeExists(volumeName) {
        await this.ensureConnection();
        const diskPath = path.join(config.VM_STORAGE_DIR || '/var/lib/libvirt/images', `${volumeName}.qcow2`);
        return fs.existsSync(diskPath);
    }

    // ✅ Список томов (дисков)
    async listVolumes() {
        await this.ensureConnection();
        
        const storageDir = config.VM_STORAGE_DIR || '/var/lib/libvirt/images';
        if (!fs.existsSync(storageDir)) return [];
        
        const files = fs.readdirSync(storageDir);
        return files
            .filter(f => f.endsWith('.qcow2'))
            .map(f => {
                const stat = fs.statSync(path.join(storageDir, f));
                return {
                    Name: f.replace('.qcow2', ''),
                    Mountpoint: path.join(storageDir, f),
                    CreatedAt: stat.birthtime.toISOString(),
                    Size: stat.size
                };
            });
    }
}

module.exports = new LibvirtService();