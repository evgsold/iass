// server/config.js
module.exports = {
    PORT: process.env.PORT || 5000,
    
    // Пути для libvirt
    MODE: process.env.NODE_ENV === 'development' ? 'docker' : 'libvirt',
    LIBVIRT_URI: 'qemu:///system',
    VM_STORAGE_DIR: '/var/lib/libvirt/images',
    ISO_DIR: '/var/lib/libvirt/isos',
    CLOUD_INIT_DIR: '/var/lib/libvirt/cloud-init',
    
    // Образ Ubuntu Cloud
    CLOUD_IMAGE_URL: 'https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img',
    CLOUD_IMAGE_PATH: '/var/lib/libvirt/isos/jammy-server-cloudimg-amd64.img',
    
    // SSH настройки
    SSH_USER: 'deploy',
    SSH_PORT: 22,
    SSH_KEY_PATH: process.env.SSH_KEY_PATH || '/home/youruser/.ssh/id_rsa',
    
    // Сеть
    VM_NETWORK: 'default',
    BASE_HOST_PORT: 30000,
    
    // Ресурсы по умолчанию
    DEFAULT_RAM: 2048,
    DEFAULT_CPU: 2,
    DEFAULT_DISK: 20,

    // Database
    DB_HOST: process.env.DB_HOST || 'localhost',
    DB_PORT: process.env.DB_PORT || 5432,
    DB_USER: process.env.DB_USER || 'postgres',
    DB_PASSWORD: process.env.DB_PASSWORD || 'postgres',
    DB_NAME: process.env.DB_NAME || 'iaas_platform',
    
    // JWT
    JWT_SECRET: process.env.JWT_SECRET || 'super-secret-key-change-me',
    JWT_EXPIRES_IN: '24h',

    // GitHub OAuth
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID || '',
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET || '',
    GITHUB_CALLBACK_URL: process.env.GITHUB_CALLBACK_URL || 'http://localhost:5001/api/auth/github/callback',
    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
    
    // Domain
    BASE_DOMAIN: 'iaasapp.pro',
    PROXY_PORT: 80,
    
    // Internal Service URLs (for Proxy)
    API_SERVICE_URL: process.env.API_SERVICE_URL || 'http://127.0.0.1:5001',
    FRONTEND_SERVICE_URL: process.env.FRONTEND_SERVICE_URL || 'http://127.0.0.1:3000',
    VM_HOST: process.env.VM_HOST || '127.0.0.1', // Use host.docker.internal in Docker

    // SSL
    LETSENCRYPT_EMAIL: 'evgsoldatenko@gmail.com', // Change this to real email
    LETSENCRYPT_AGREE_TOS: true
};