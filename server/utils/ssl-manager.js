// utils/ssl-manager.js
const greenlock = require('greenlock-express');
const glx = greenlock.init({
    packageRoot: __dirname,
    configDir: './greenlock.d',
    maintainerEmail: process.env.LETSENCRYPT_EMAIL,
    cluster: false,
    staging: process.env.NODE_ENV !== 'production'
});

const registerDomainSSL = async (domain) => {
    return new Promise((resolve, reject) => {
        glx.manager.add({
            subject: domain,
            altnames: [domain],
            email: process.env.LETSENCRYPT_EMAIL,
            agreeTos: true
        }).then(() => {
            // Ждём немного, пока Greenlock выполнит ACME challenge
            setTimeout(resolve, 3000);
        }).catch(reject);
    });
};

module.exports = { registerDomainSSL };