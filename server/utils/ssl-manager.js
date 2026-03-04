// utils/ssl-manager.js
const path = require('path');
const greenlockExpress = require('greenlock-express');
const logger = require('./logger');

// Инициализируем один раз при старте
let glxInstance = null;

const initGreenlock = () => {
    if (glxInstance) return glxInstance;
    
    glxInstance = greenlockExpress.init({
        // 🔥 Ключевое исправление: packageRoot должен указывать туда, где лежит package.json
        packageRoot: path.join(__dirname, '..'),
        
        // Пути к конфигурации тоже должны быть абсолютными или относительно packageRoot
        configDir: path.join(__dirname, '..', 'greenlock.d'),
        
        maintainerEmail: 'evgsoldatenko@gmail.com',
        cluster: false,
        staging: false // true для тестов
    });
    
    return glxInstance;
};

const registerDomainSSL = async (domain) => {
    const glx = initGreenlock();
    
    return new Promise((resolve, reject) => {
        glx.manager.add({
            subject: domain,
            altnames: [domain],
            email: 'evgsoldatenko@gmail.com',
            agreeTos: true
        })
        .then(() => {
            logger.info(`SSL registered for ${domain}`);
            // Даём время на выполнение ACME challenge
            setTimeout(resolve, 2000);
        })
        .catch((err) => {
            logger.error(`SSL registration failed for ${domain}:`, err);
            reject(err);
        });
    });
};

const hasCertificate = (domain) => {
    const glx = initGreenlock();
    return glx.manager?.hasCertificate?.(domain) || false;
};

module.exports = {
    initGreenlock,
    registerDomainSSL,
    hasCertificate
};