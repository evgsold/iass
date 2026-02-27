// server/utils/logger.js
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

const log = (level, message, data = null) => {
    const timestamp = new Date().toISOString();
    const color = colors[level.toLowerCase()] || colors.reset;
    
    console.log(`${color}[${timestamp}] [${level.toUpperCase()}]${colors.reset} ${message}`);
    if (data) console.log(data);
};

module.exports = {
    info: (msg, data) => log('info', msg, data),
    error: (msg, data) => log('error', msg, data),
    success: (msg, data) => log('success', msg, data),
    warn: (msg, data) => log('warn', msg, data),
    debug: (msg, data) => log('debug', msg, data),
};