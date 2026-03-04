const greenlockExpress = require('greenlock-express');

const initGreenlock = () => {
    if (glxInstance) return glxInstance;
    
    const glx = greenlockExpress.create({
        packageRoot: path.join(__dirname, '..'),
        configDir: path.join(__dirname, '..', 'greenlock.d'),
        maintainerEmail: 'evgsoldatenko@gmail.com',
        cluster: false,
        staging: true
    });
    
    glxInstance = glx;
    return glx;
};

const registerDomainSSL = async (domain) => {
    const glx = initGreenlock();
    
    // ✅ Use .sites.add() instead of .manager.add()
    await glx.sites.add({
        subject: domain,
        altnames: [domain],
        email: 'evgsoldatenko@gmail.com',
        agreeTos: true
    });
    
    logger.success(`SSL registered for ${domain}`);
};