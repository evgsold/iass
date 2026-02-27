require('dotenv').config();
const express = require('express');
const cors = require('cors');
const config = require('./config');
const logger = require('./utils/logger');
const { connectDB } = require('./db');
const authService = require('./services/authService');
const projectService = require('./services/projectService');
const vmManager = require('./services/vmManager');
const authMiddleware = require('./middleware/auth');
const libvirt = require('./services/hypervisor/libvirt');
const ssh = require('./services/ssh');
const socketService = require('./socket');
const { ResourceLog } = require('./models');

const app = express();
const server = require('http').createServer(app);
const io = socketService(server); // Initialize Socket.IO

// --- ИСПРАВЛЕННАЯ НАСТРОЙКА CORS ---
const corsOptions = {
    origin: function (origin, callback) {
        // Разрешаем запросы без origin (например, Postman, мобильные приложения)
        if (!origin) return callback(null, true);
        
        const allowedOrigins = [
            'http://localhost:3000',
            'http://localhost:3001',
            'http://127.0.0.1:3000',
            'http://127.0.0.1:3001',
            'https://iaasapp.pro',
            'https://*.iaasapp.pro',
            'https://104.248.205.79',
            'https://104.248.205.79:3000',
            'https://104.248.205.79:3001',
            'https://*.104.248.205.79',
            'http://104.248.205.79',
            'http://104.248.205.79:3000',
            'http://104.248.205.79:3001',
            'http://*.104.248.205.79',
        ];
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-KEY'],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
    preflightContinue: false,
    optionsSuccessStatus: 204
};
app.use(cors(corsOptions));
app.use(express.json());

// Middleware для логирования запросов
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`);
    next();
});

// Connect to Database
connectDB();

// Проверка подключения к libvirt при старте
let libvirtReady = false;
libvirt.checkConnection().then(ready => {
    libvirtReady = ready;
    if (!ready) {
        logger.warn('Libvirt недоступен. Работа в демо-режиме.');
    }
});

// --- Auth Routes ---

app.get('/api/auth/github', (req, res) => {
    const url = `https://github.com/login/oauth/authorize?client_id=${config.GITHUB_CLIENT_ID}&scope=user:email,repo&redirect_uri=${config.GITHUB_CALLBACK_URL}`;
    res.json({ url });
});

app.get('/api/auth/github/callback', async (req, res) => {
    try {
        const { code } = req.query;
        const { token } = await authService.githubLogin(code);
        // Redirect back to frontend with token
        res.redirect(`${config.FRONTEND_URL}/login?token=${token}`);
    } catch (error) {
        logger.error('GitHub Login Error:', error);
        res.redirect(`${config.FRONTEND_URL}/login?error=auth_failed`);
    }
});

app.get('/api/github/repos', authMiddleware, async (req, res) => {
    try {
        const repos = await authService.getGithubRepos(req.user.id);
        res.json(repos);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const result = await authService.register(req.body);
        res.status(201).json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await authService.login(email, password);
        res.json(result);
    } catch (error) {
        res.status(401).json({ error: error.message });
    }
});

// --- Project Routes ---

app.use('/api/projects', authMiddleware);

app.post('/api/projects', async (req, res) => {
    try {
        const { name, description } = req.body;
        const project = await projectService.createProject(req.user.id, name, description);
        res.status(201).json(project);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.get('/api/projects', async (req, res) => {
    try {
        const projects = await projectService.getProjects(req.user.id);
        res.json(projects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects/:id', async (req, res) => {
    try {
        const project = await projectService.getProject(req.params.id, req.user.id);
        res.json(project);
    } catch (error) {
        res.status(404).json({ error: error.message });
    }
});

app.post('/api/projects/:id/users', async (req, res) => {
    try {
        const { email, role } = req.body;
        const result = await projectService.addUserToProject(req.params.id, req.user.id, email, role);
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// --- VM Routes ---

// Create VM in a project
app.post('/api/projects/:projectId/vms', authMiddleware, async (req, res) => {
    try {
        // Check if user has access to project
        await projectService.getProject(req.params.projectId, req.user.id);
        
        const { githubUrl, name, ram, cpu, disk } = req.body;
        const vm = await vmManager.createVM({ githubUrl, name, ram, cpu, disk }, req.params.projectId);
        
        res.status(201).json(vm);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get VM details
app.get('/api/vms/:id', authMiddleware, async (req, res) => {
    try {
        const vm = await vmManager.getVM(req.params.id);
        if (!vm) return res.status(404).json({ error: 'ВМ не найдена' });
        
        // Check access
        await projectService.getProject(vm.projectId, req.user.id);
        
        res.json(vm);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Backup Routes ---
    app.post('/api/vms/:id/backups', authMiddleware, async (req, res) => {
        try {
            const { name } = req.body;
            const vm = await vmManager.getVM(req.params.id);
            if (!vm) return res.status(404).json({ error: 'ВМ не найдена' });
            
            await projectService.getProject(vm.projectId, req.user.id);
            
            const backup = await vmManager.createBackup(vm.id, name, vm.projectId);
            res.status(201).json(backup);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/vms/:id/backups', authMiddleware, async (req, res) => {
        try {
            const vm = await vmManager.getVM(req.params.id);
            if (!vm) return res.status(404).json({ error: 'ВМ не найдена' });
            
            await projectService.getProject(vm.projectId, req.user.id);
            
            const backups = await vmManager.getBackups(vm.id, vm.projectId);
            res.json(backups);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/api/vms/:id/restore/:backupId', authMiddleware, async (req, res) => {
        try {
            const vm = await vmManager.getVM(req.params.id);
            if (!vm) return res.status(404).json({ error: 'ВМ не найдена' });
            
            await projectService.getProject(vm.projectId, req.user.id);
            
            await vmManager.restoreBackup(vm.id, req.params.backupId, vm.projectId);
            res.json({ message: 'ВМ восстановлена из бекапа' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // --- Resize Route ---
    app.post('/api/vms/:id/resize', authMiddleware, async (req, res) => {
        try {
            const { ram, cpu } = req.body;
            const vm = await vmManager.getVM(req.params.id);
            if (!vm) return res.status(404).json({ error: 'ВМ не найдена' });
            
            await projectService.getProject(vm.projectId, req.user.id);
            
            const updatedVM = await vmManager.resizeVM(vm.id, parseInt(ram), parseInt(cpu), vm.projectId);
            res.json(updatedVM);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

// VM Actions
app.post('/api/vms/:id/:action', authMiddleware, async (req, res) => {
    try {
        const { action } = req.params;
        const vm = await vmManager.getVM(req.params.id);
        if (!vm) return res.status(404).json({ error: 'ВМ не найдена' });
        
        // Check access
        await projectService.getProject(vm.projectId, req.user.id);

        if (action === 'start') {
            await vmManager.startVM(vm.id, vm.projectId);
        } else if (action === 'stop') {
            await vmManager.stopVM(vm.id, vm.projectId);
        } else if (action === 'redeploy') {
             if (!vm.ip) return res.status(400).json({ error: 'ВМ не имеет IP' });
             
             const result = await ssh.deployApp(vm.ip, vm.githubUrl, vm.name);
             if (result.success) {
                 await vm.update({ status: 'deployed' });
             } else {
                 await vm.update({ status: 'error', error: result.error });
             }
             return res.json(result);
        } else {
            return res.status(400).json({ error: 'Неизвестное действие' });
        }
        
        res.json({ message: `Действие ${action} выполнено` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


    app.delete('/api/vms/:id', authMiddleware, async (req, res) => {
    try {
        const vm = await vmManager.getVM(req.params.id);
        if (!vm) return res.status(404).json({ error: 'ВМ не найдена' });
        
        // Check access
        await projectService.getProject(vm.projectId, req.user.id);
        
        await vmManager.deleteVM(vm.id, vm.projectId);
        res.json({ message: 'ВМ удалена' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

    app.get('/api/vms/:id/logs', authMiddleware, async (req, res) => {
        try {
            const vm = await vmManager.getVM(req.params.id);
            if (!vm) return res.status(404).json({ error: 'ВМ не найдена' });
            
            // Check access
            await projectService.getProject(vm.projectId, req.user.id);

            const logs = await vmManager.getLogs(req.params.id);
            res.json({ logs });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Real-time Status
    app.get('/api/vms/:id/status', authMiddleware, async (req, res) => {
        try {
            const vm = await vmManager.getVM(req.params.id);
            if (!vm) return res.status(404).json({ error: 'ВМ не найдена' });
            
            // Check access
            await projectService.getProject(vm.projectId, req.user.id);

            const status = await vmManager.getVMRealStatus(req.params.id);
            res.json(status);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Resource Logs
    app.get('/api/vms/:id/resources', authMiddleware, async (req, res) => {
        try {
            const vm = await vmManager.getVM(req.params.id);
            if (!vm) return res.status(404).json({ error: 'ВМ не найдена' });
            
            // Check access
            await projectService.getProject(vm.projectId, req.user.id);
            
            // Если запрошен параметр current=true, возвращаем текущую статистику
            if (req.query.current === 'true') {
                 const stats = await vmManager.getVMResourceStats(vm.id, 0);
                 if (stats && stats.currentCpu !== undefined) {
                     return res.json([{
                         timestamp: new Date(),
                         cpuUsage: stats.currentCpu,
                         ramUsage: stats.currentRam
                     }]);
                 }
            }

            const logs = await ResourceLog.findAll({
                where: { vmId: vm.id },
                order: [['timestamp', 'DESC']],
                limit: 100
            });
            res.json(logs);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

const startServer = (port) => {
    server.listen(port, () => {
        logger.success(`🚀 Next.js Cloud Platform API запущен`);
        logger.info(`📍 Порт: ${port}`);
        logger.info(`🔗 URL: http://localhost:${port}`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            logger.warn(`Порт ${port} занят, пробуем ${port + 1}...`);
            startServer(port + 1);
        } else {
            logger.error('Ошибка сервера', err);
        }
    });
};

startServer(config.PORT);
