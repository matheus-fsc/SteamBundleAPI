const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const moment = require('moment-timezone');
const fs = require('fs');
const { fetchAndSaveBundles } = require('./fetchBundles');
const routes = require('./routes');

const app = express();
app.use(cors());
app.use(routes);

const LAST_CHECK_FILE = 'last_check.json';
const TIMEZONE = process.env.TIMEZONE || 'America/Sao_Paulo'; // Horário de Brasília

// Verificar a última verificação ao iniciar o servidor
const checkLastVerification = () => {
    if (fs.existsSync(LAST_CHECK_FILE)) {
        const lastCheckData = fs.readFileSync(LAST_CHECK_FILE, 'utf-8');
        const lastCheck = JSON.parse(lastCheckData).lastCheck;
        const now = moment().tz(TIMEZONE);
        const lastCheckMoment = moment.tz(lastCheck, TIMEZONE);

        // Se a última verificação foi há mais de 6 horas, faça uma nova verificação
        if (now.diff(lastCheckMoment, 'hours') >= 6) {
            fetchAndSaveBundles();
        } else {
            console.log('A última verificação foi realizada há menos de 6 horas.');
        }
    } else {
        // Se o arquivo não existir, faça uma nova verificação
        fetchAndSaveBundles();
    }
};

// Agendar a verificação para ocorrer a cada 6 horas
cron.schedule('0 */6 * * *', fetchAndSaveBundles, {
    timezone: TIMEZONE
});

checkLastVerification();

const PORT = process.env.PORT || 5005;
app.listen(PORT, () => console.log(`Servidor rodando no localhost:${PORT}`));