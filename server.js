require('dotenv').config();

const app = require('./src/app');

const PORT = process.env.PORT || 3000;

// Only start the HTTP server when run directly (local dev).
// When imported by Vercel's serverless runtime, it uses module.exports instead.
if (require.main === module) {
  // O Express 5 entrega o erro de listen no callback; sem tratá-lo o processo
  // encerra com código 0 quando a porta está ocupada e o pm2 não percebe a falha.
  app.listen(PORT, (error) => {
    if (error) {
      console.error(`[servidor] Não foi possível escutar na porta ${PORT}:`, error.code || error.message);
      process.exit(1);
    }
    console.log(`Servidor rodando na porta ${PORT}`);
  });
}

module.exports = app;
