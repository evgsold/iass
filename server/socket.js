const { Server } = require("socket.io");
const jwt = require('jsonwebtoken');
const config = require('./config');
const logger = require('./utils/logger');
const vmManager = require('./services/vmManager');

module.exports = (httpServer) => {
    const io = new Server(httpServer, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    io.use((socket, next) => {
        const token = socket.handshake.auth.token || socket.handshake.query.token;
        if (token) {
            jwt.verify(token, config.JWT_SECRET, (err, decoded) => {
                if (err) return next(new Error('Authentication error'));
                socket.decoded = decoded;
                next();
            });
        } else {
            next(new Error('Authentication error'));
        }
    });

    io.on("connection", (socket) => {
        logger.info(`Client connected: ${socket.id}`);

        socket.on("attach-terminal", async (vmId) => {
            try {
                const vm = await vmManager.getVM(vmId);
                if (!vm) {
                    socket.emit('error', 'VM not found');
                    return;
                }
                
                if (config.MODE === 'docker') {
                    const dockerService = require('./services/hypervisor/docker');
                    await dockerService.ensureConnection();
                    const container = dockerService.docker.getContainer(vm.name);

                    // Создаем exec инстанс
                    const exec = await container.exec({
                        Cmd: ['/bin/sh'],
                        AttachStdin: true,
                        AttachStdout: true,
                        AttachStderr: true,
                        Tty: true
                    });

                    // Запускаем exec и получаем поток
                    exec.start({ hijack: true, stdin: true }, (err, stream) => {
                        if (err) {
                            socket.emit('error', 'Exec start failed: ' + err.message);
                            return;
                        }

                        // Dockerode stream output is multiplexed if Tty is false, but raw if Tty is true.
                        // With Tty: true, it's a raw stream.
                        
                        stream.on('data', (chunk) => {
                            socket.emit('data', chunk.toString('utf8'));
                        });

                        socket.on('data', (data) => {
                            stream.write(data);
                        });
                        
                        socket.on('resize', (size) => {
                             exec.resize({ h: size.rows, w: size.cols }).catch(() => {});
                        });

                        socket.on('disconnect', () => {
                            stream.end();
                        });
                    });
                } else {
                    socket.emit('data', 'Web terminal not supported for Libvirt yet.\r\n');
                }
            } catch (err) {
                logger.error('Terminal error:', err);
                socket.emit('error', err.message);
            }
        });

        socket.on("disconnect", () => {
            logger.info(`Client disconnected: ${socket.id}`);
        });
    });
    
    return io;
};