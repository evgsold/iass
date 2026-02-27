// server/services/libvirt.js
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const logger = require('../../utils/logger');

class LibvirtService {
    constructor() {
        this.connected = false;
    }

    async checkConnection() {
        return new Promise((resolve) => {
            exec('virsh --connect qemu:///system list', (err) => {
                if (err) {
                    logger.error('Не удалось подключиться к libvirt');
                    this.connected = false;
                    resolve(false);
                } else {
                    this.connected = true;
                    logger.success('Подключено к libvirt');
                    resolve(true);
                }
            });
        });
    }

    async runCommand(cmd) {
        return new Promise((resolve, reject) => {
            exec(`virsh ${cmd}`, { timeout: 30000 }, (err, stdout, stderr) => {
                if (err) reject(new Error(stderr || err.message));
                else resolve(stdout.trim());
            });
        });
    }

    async createDisk(vmName, sizeGB) {
        const diskPath = path.join(config.VM_STORAGE_DIR, `${vmName}.qcow2`);
        await this.runCommand(`qemu-img create -f qcow2 ${diskPath} ${sizeGB}G`);
        logger.info(`Диск создан: ${diskPath}`);
        return diskPath;
    }

    async createVM(vmConfig) {
        const xmlPath = path.join('/tmp', `${vmConfig.name}.xml`);
        const xml = this.generateVMXml(vmConfig);
        
        fs.writeFileSync(xmlPath, xml);
        await this.runCommand(`create ${xmlPath}`);
        
        logger.success(`ВМ ${vmConfig.name} запущена`);
        return true;
    }

    generateVMXml(config) {
        return `<?xml version='1.0' encoding='UTF-8'?>
<domain type='kvm' xmlns:qemu='http://libvirt.org/schemas/domain/qemu/1.0'>
  <name>${config.name}</name>
  <memory unit='MiB'>${config.ram}</memory>
  <vcpu>${config.cpu}</vcpu>
  <os>
    <type arch='x86_64' machine='pc'>hvm</type>
    <boot dev='hd'/>
  </os>
  <features>
    <acpi/>
    <apic/>
  </features>
  <cpu mode='host-passthrough'/>
  <devices>
    <disk type='file' device='disk'>
      <driver name='qemu' type='qcow2' cache='none'/>
      <source file='${config.diskPath}'/>
      <target dev='vda' bus='virtio'/>
    </disk>
    <disk type='file' device='cdrom'>
      <target dev='hdc' bus='ide'/>
      <readonly/>
      <source file='${config.cloudInitIso}'/>
    </disk>
    <interface type='network'>
      <source network='${config.network}'/>
      <model type='virtio'/>
    </interface>
    <console type='pty'>
      <target type='serial' port='0'/>
    </console>
    <qemu:commandline>
        <qemu:arg value='-redir'/>
        <qemu:arg value='tcp:${config.hostPort}::3000'/>
    </qemu:commandline>
    <graphics type='vnc' port='-1' autoport='yes' listen='0.0.0.0'/>
  </devices>
</domain>`;
    }

    async getVMStatus(vmName) {
        try {
            const state = await this.runCommand(`domstate ${vmName}`);
            return state.toLowerCase();
        } catch {
            return 'not_found';
        }
    }

    async stopVM(vmName) {
        await this.runCommand(`destroy ${vmName}`);
        logger.info(`ВМ ${vmName} остановлена`);
    }

    async deleteVM(vmName) {
        try {
            await this.runCommand(`destroy ${vmName}`);
        } catch {}
        
        await this.runCommand(`undefine ${vmName} --remove-all-storage`);
        
        // Удаляем cloud-init ISO
        const isoPath = path.join(config.ISO_DIR, `${vmName}-cidata.iso`);
        if (fs.existsSync(isoPath)) fs.unlinkSync(isoPath);
        
        logger.success(`ВМ ${vmName} удалена`);
    }

    async getVMIP(vmName) {
        try {
            const leases = await this.runCommand('net-dhcp-leases default');
            const lines = leases.split('\n');
            for (const line of lines) {
                if (line.includes(vmName)) {
                    const ip = line.match(/\d+\.\d+\.\d+\.\d+/);
                    if (ip) return ip[0];
                }
            }
        } catch {}
        return null;
    }
}

module.exports = new LibvirtService();