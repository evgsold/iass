const logger = require('../utils/logger');

module.exports = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        logger.warn(`Unauthorized admin access attempt by user: ${req.user ? req.user.email : 'unknown'}`);
        res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }
};
