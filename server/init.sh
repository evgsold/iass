#!/bin/bash
# server/init.sh

echo "🔧 Инициализация Next.js Cloud Platform..."

# Создаем директории
sudo mkdir -p /var/lib/libvirt/images
sudo mkdir -p /var/lib/libvirt/isos
sudo mkdir -p /var/lib/libvirt/cloud-init

# Устанавливаем зависимости
sudo apt update
sudo apt install -y qemu-kvm libvirt-daemon-system libvirt-clients bridge-utils virtinst cloud-image-utils

# Добавляем пользователя в группы
sudo usermod -aG libvirt,kvm $USER

# Скачиваем cloud image
if [ ! -f /var/lib/libvirt/isos/jammy-server-cloudimg-amd64.img ]; then
    echo "📥 Скачивание Ubuntu Cloud Image..."
    sudo wget -O /var/lib/libvirt/isos/jammy-server-cloudimg-amd64.img \
        https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img
fi

# Генерируем SSH ключ если нет
if [ ! -f ~/.ssh/id_rsa ]; then
    echo "🔑 Генерация SSH ключа..."
    ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa -N ""
fi

# Проверяем libvirt
echo "✅ Проверка libvirt..."
virsh --connect qemu:///system list

echo "✅ Инициализация завершена!"
echo "📝 Запустите: npm start"