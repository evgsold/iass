const http = require('http');
const httpProxy = require('http-proxy');
const { exec } = require('child_process');
const { VM } = require('./models');
const config = require('./config');
const logger = require('./utils/logger');

// Create a proxy server with custom application logic
const proxy = httpProxy.createProxyServer({});

// Ensure base domain SSL is configured
const registerBaseDomain = () => {
    const domain = config.BASE_DOMAIN;
    logger.info(`Checking SSL configuration for ${domain}...`);
    // We run this asynchronously to not block startup, Greenlock will pick it up when config changes
    exec(`npx greenlock add --subject ${domain} --altnames ${domain},www.${domain}`, { cwd: __dirname }, (err, stdout, stderr) => {
        if (err) {
            // Ignore if it says "Subject already exists" or similar non-fatal errors
            if (!stderr.includes('already')) {
                logger.warn(`Base domain SSL registration warning: ${stderr}`);
            }
        } else {
            logger.success(`SSL configuration updated for ${domain}`);
        }
    });
};

registerBaseDomain();

// Main request handler
const app = async (req, res) => {
    const host = req.headers.host;
    if (!host) {
        res.writeHead(400);
        res.end('Bad Request: Host header missing');
        return;
    }

    const subdomain = host.split('.')[0];
    const baseDomain = config.BASE_DOMAIN;

    // Handle main domain (Frontend)
    if (host === baseDomain || host === `www.${baseDomain}`) {
        proxy.web(req, res, { target: config.FRONTEND_SERVICE_URL });
        return;
    }

    // Handle API subdomain
    if (subdomain === 'api') {
        proxy.web(req, res, { target: config.API_SERVICE_URL });
        return;
    }

    // Handle Dashboard subdomain (optional, if you want dashboard.domain.com)
    if (subdomain === 'dashboard') {
        proxy.web(req, res, { target: config.FRONTEND_SERVICE_URL });
        return;
    }

    try {
        const vm = await VM.findOne({ where: { subdomain } });

        if (vm && vm.hostPort && (vm.status === 'running' || vm.status === 'deployed')) {
            // Proxy to the VM's port
            proxy.web(req, res, { target: `http://${config.VM_HOST}:${vm.hostPort}` }, (err) => {
                logger.error(`Proxy error for ${subdomain}:`, err.message);
                if (!res.headersSent) {
                    res.writeHead(502);
                    res.end('Bad Gateway: Application not reachable');
                }
            });
        } else {
            res.writeHead(404);
            res.end(`Application '${subdomain}' not found or not running`);
        }
    } catch (error) {
        logger.error('Proxy lookup error:', error);
        if (!res.headersSent) {
            res.writeHead(500);
            res.end('Internal Server Error');
        }
    }
};

// WebSocket upgrade handler
const handleUpgrade = async (req, socket, head) => {
    const host = req.headers.host;
    if (!host) return;

    const subdomain = host.split('.')[0];
    const baseDomain = config.BASE_DOMAIN;
    
    // Proxy WebSockets for main domain (if app uses them)
    if (host === baseDomain || host === `www.${baseDomain}` || subdomain === 'dashboard') {
        proxy.ws(req, socket, head, { target: config.FRONTEND_SERVICE_URL });
        return;
    }

    if (subdomain === 'api') {
        proxy.ws(req, socket, head, { target: config.API_SERVICE_URL });
        return;
    }

    try {
        const vm = await VM.findOne({ where: { subdomain } });
        if (vm && vm.hostPort) {
            proxy.ws(req, socket, head, { target: `http://${config.VM_HOST}:${vm.hostPort}` });
        }
    } catch (e) {
        socket.end();
    }
};

// Initialize Greenlock
require('greenlock-express').init({
    packageRoot: __dirname,
    configDir: './greenlock.d',
    maintainerEmail: config.LETSENCRYPT_EMAIL,
    cluster: false,
    staging: false // Set to true for testing to avoid rate limits
}).ready(httpsWorker);

function httpsWorker(glx) {
    // Start the HTTPS server
    const httpsServer = glx.httpsServer(null, app);

    httpsServer.on('upgrade', handleUpgrade);

    httpsServer.listen(443, "0.0.0.0", () => {
        logger.success('HTTPS Server listening on port 443');
    });

    // Start the HTTP server (for redirects and ACME challenges)
    const httpServer = glx.httpServer();
    
    httpServer.on('upgrade', handleUpgrade);

    httpServer.listen(80, "0.0.0.0", () => {
        logger.success('HTTP Server listening on port 80');
    });
}