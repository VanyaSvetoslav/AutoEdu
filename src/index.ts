import { Bot } from 'grammy';
import { config } from './config.js';
import { registerHandlers } from './handlers.js';
import { createTelegramProxyAgent } from './proxy.js';

async function main(): Promise<void> {
  const proxyAgent = createTelegramProxyAgent(config.TELEGRAM_PROXY_URL);
  if (proxyAgent) {
    console.log(`Routing Telegram traffic through proxy: ${config.TELEGRAM_PROXY_URL}`);
  }

  // grammY uses node-fetch under the hood; node-fetch accepts an `agent` option
  // on each request. Mosreg uses undici directly (no proxy), so its requests
  // continue to exit through the host's real IP.
  const bot = new Bot(config.BOT_TOKEN, {
    client: proxyAgent
      ? {
          baseFetchConfig: {
            agent: proxyAgent,
            compress: true,
          },
        }
      : {},
  });
  registerHandlers(bot);

  await bot.api.setMyCommands([
    { command: 'today', description: 'ДЗ на сегодня' },
    { command: 'tomorrow', description: 'ДЗ на завтра' },
    { command: 'week', description: 'ДЗ на 7 дней' },
    { command: 'hw', description: 'ДЗ на дату или диапазон' },
    { command: 'marks', description: 'Оценки (или /marks <предмет>)' },
    { command: 'help', description: 'Справка' },
  ]);

  console.log('AutoEdu bot starting…');

  const stop = async (): Promise<void> => {
    console.log('Stopping…');
    await bot.stop();
    process.exit(0);
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());

  await bot.start({
    onStart: (info) => console.log(`Logged in as @${info.username} (id=${info.id})`),
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
