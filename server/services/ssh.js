// server/services/ssh.js
const { Client } = require('ssh2');
const fs = require('fs');
const config = require('../config');
const logger = require('../utils/logger');

class SSHService {
    constructor() {
        this.connections = new Map();
    }

    async connect(host, username = config.SSH_USER, privateKeyPath = config.SSH_KEY_PATH) {
        return new Promise((resolve, reject) => {
            const conn = new Client();
            
            conn.on('ready', () => {
                logger.success(`SSH подключено к ${host}`);
                this.connections.set(host, conn);
                resolve(conn);
            });

            conn.on('error', (err) => {
                logger.error(`SSH ошибка подключения к ${host}`, err.message);
                reject(err);
            });

            conn.connect({
                host,
                port: config.SSH_PORT,
                username,
                privateKey: fs.readFileSync(privateKeyPath),
                readyTimeout: 30000,
                retries: 3,
                retryFactor: 2,
            });
        });
    }

    async execute(conn, command) {
        return new Promise((resolve, reject) => {
            conn.exec(command, (err, stream) => {
                if (err) reject(err);
                
                let stdout = '';
                let stderr = '';
                
                stream.on('close', (code) => {
                    resolve({ code, stdout, stderr });
                });
                
                stream.on('data', (data) => {
                    stdout += data.toString();
                    logger.debug(`STDOUT: ${data}`);
                });
                
                stream.stderr.on('data', (data) => {
                    stderr += data.toString();
                    logger.debug(`STDERR: ${data}`);
                });
            });
        });
    }

    async deployApp(host, githubUrl, appName) {
        const conn = await this.connect(host);
        const appDir = `/home/${config.SSH_USER}/app`;
        
        try {
            logger.info(`Начало деплоя ${appName} на ${host}`);
            
            // Клонируем репозиторий
            await this.execute(conn, `rm -rf ${appDir}/*`);
            await this.execute(conn, `git clone ${githubUrl} ${appDir}`);
            
            // Установка зависимостей
            await this.execute(conn, `cd ${appDir} && npm install`);
            
            // Сборка
            await this.execute(conn, `cd ${appDir} && npm run build`);
            
            // Запуск приложения
            await this.execute(conn, `cd ${appDir} && nohup npm start -- -p 3000 > /var/log/${appName}.log 2>&1 &`);
            
            logger.success(`Деплой ${appName} завершен`);
            return { success: true, appDir };
            
        } catch (error) {
            logger.error('Ошибка деплоя', error);
            return { success: false, error: error.message };
        }
    }

    async getLogs(host, appName) {
        const conn = this.connections.get(host);
        if (!conn) return 'Нет подключения';
        
        const result = await this.execute(conn, `tail -100 /var/log/${appName}.log`);
        return result.stdout;
    }

    disconnect(host) {
        const conn = this.connections.get(host);
        if (conn) {
            conn.end();
            this.connections.delete(host);
            logger.info(`SSH отключено от ${host}`);
        }
    }
}

module.exports = new SSHService();