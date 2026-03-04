const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('./logger');

const transporter = nodemailer.createTransport({
    host: config.EMAIL_HOST,
    port: config.EMAIL_PORT,
    secure: false, // Use 'true' if port is 465 and secure connection is desired
    auth: {
        user: config.EMAIL_USER,
        pass: config.EMAIL_PASSWORD,
    },
});

const sendMail = async (to, subject, htmlContent) => {
    try {
        await transporter.sendMail({
            from: config.EMAIL_FROM,
            to,
            subject,
            html: htmlContent,
        });
        logger.info(`Email sent to ${to} for subject: ${subject}`);
    } catch (error) {
        logger.error(`Failed to send email to ${to}:`, error);
    }
};

module.exports = { sendMail };
