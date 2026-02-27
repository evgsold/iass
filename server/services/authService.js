const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { User } = require('../models');
const config = require('../config');

class AuthService {
    async register(userData) {
        const { email, password, name } = userData;
        
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            throw new Error('Пользователь с таким email уже существует');
        }

        const user = await User.create({ email, password, name });
        const token = this.generateToken(user);

        return { user, token };
    }

    async login(email, password) {
        const user = await User.findOne({ where: { email } });
        if (!user) {
            throw new Error('Неверный email или пароль');
        }

        if (!user.password) {
             throw new Error('Пожалуйста, войдите через GitHub');
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            throw new Error('Неверный email или пароль');
        }

        const token = this.generateToken(user);
        return { user, token };
    }

    async githubLogin(code) {
        // 1. Exchange code for access token
        const tokenResponse = await axios.post('https://github.com/login/oauth/access_token', {
            client_id: config.GITHUB_CLIENT_ID,
            client_secret: config.GITHUB_CLIENT_SECRET,
            code
        }, {
            headers: { Accept: 'application/json' }
        });

        const accessToken = tokenResponse.data.access_token;
        if (!accessToken) {
            throw new Error('Failed to get access token from GitHub');
        }

        // 2. Get user info
        const userResponse = await axios.get('https://api.github.com/user', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const githubUser = userResponse.data;
        
        // 3. Get user email (might be private)
        let email = githubUser.email;
        if (!email) {
            const emailsResponse = await axios.get('https://api.github.com/user/emails', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            const primaryEmail = emailsResponse.data.find(e => e.primary && e.verified);
            email = primaryEmail ? primaryEmail.email : null;
        }

        if (!email) {
            throw new Error('GitHub account must have a verified email');
        }

        // 4. Find or create user
        let user = await User.findOne({ 
            where: { 
                [require('sequelize').Op.or]: [
                    { githubId: String(githubUser.id) },
                    { email: email }
                ]
            } 
        });

        if (user) {
            // Update existing user with latest token and info
            await user.update({
                githubId: String(githubUser.id),
                githubToken: accessToken,
                avatarUrl: githubUser.avatar_url,
                name: user.name || githubUser.name || githubUser.login
            });
        } else {
            // Create new user
            user = await User.create({
                email,
                name: githubUser.name || githubUser.login,
                githubId: String(githubUser.id),
                githubToken: accessToken,
                avatarUrl: githubUser.avatar_url,
                role: 'user'
            });
        }

        const token = this.generateToken(user);
        return { user, token };
    }

    async getGithubRepos(userId) {
        const user = await User.findByPk(userId);
        if (!user || !user.githubToken) {
            throw new Error('GitHub not connected');
        }

        try {
            const response = await axios.get('https://api.github.com/user/repos?sort=updated&per_page=100&type=all', {
                headers: { Authorization: `Bearer ${user.githubToken}` }
            });
            return response.data.map(repo => ({
                id: repo.id,
                name: repo.name,
                full_name: repo.full_name,
                html_url: repo.html_url,
                private: repo.private,
                language: repo.language
            }));
        } catch (error) {
            console.error('GitHub API Error:', error.response?.data || error.message);
            throw new Error('Failed to fetch repositories');
        }
    }

    generateToken(user) {
        return jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            config.JWT_SECRET,
            { expiresIn: config.JWT_EXPIRES_IN }
        );
    }
}

module.exports = new AuthService();
