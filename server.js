import express from 'express';
import bodyParser from 'body-parser';
import { SingboxConfigBuilder } from './src/SingboxConfigBuilder.js';
import { generateHtml } from './src/htmlBuilder.js';
import { ClashConfigBuilder } from './src/ClashConfigBuilder.js';
import { SurgeConfigBuilder } from './src/SurgeConfigBuilder.js';
import { GenerateWebPath } from './src/utils.js';
import { PREDEFINED_RULE_SETS } from './src/config.js';
import { t, setLanguage } from './src/i18n/index.js';
import yaml from 'js-yaml';
import { kvGet, kvPut } from './src/kvSqlite.js';

const app = express();
const PORT = process.env.PORT || 7788;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  const lang = req.query.lang || req.headers['accept-language']?.split(',')[0];
  setLanguage(lang);
  res.setHeader('Content-Type', 'text/html');
  res.send(generateHtml('', '', '', '', req.protocol + '://' + req.get('host')));
});

app.get(['/singbox', '/clash', '/surge'], async (req, res) => {
  let { config: inputString, selectedRules, customRules, lang, ua: userAgent, configId } = req.query;
  lang = lang || 'zh-CN';
  setLanguage(lang);
  userAgent = userAgent || 'curl/7.74.0';

  if (!inputString) return res.status(400).send(t('missingConfig'));

  if (PREDEFINED_RULE_SETS[selectedRules]) {
    selectedRules = PREDEFINED_RULE_SETS[selectedRules];
  } else {
    try {
      selectedRules = JSON.parse(decodeURIComponent(selectedRules));
    } catch {
      selectedRules = PREDEFINED_RULE_SETS.minimal;
    }
  }

  try {
    customRules = JSON.parse(decodeURIComponent(customRules));
  } catch {
    customRules = [];
  }

  let baseConfig;
  if (configId) {
    const customConfig = kvGet(configId);
    if (customConfig) baseConfig = JSON.parse(customConfig);
  }

  let configBuilder;
  if (req.path.startsWith('/singbox')) {
    configBuilder = new SingboxConfigBuilder(inputString, selectedRules, customRules, baseConfig, lang, userAgent);
  } else if (req.path.startsWith('/clash')) {
    configBuilder = new ClashConfigBuilder(inputString, selectedRules, customRules, baseConfig, lang, userAgent);
  } else {
    configBuilder = new SurgeConfigBuilder(inputString, selectedRules, customRules, baseConfig, lang, userAgent)
      .setSubscriptionUrl(req.protocol + '://' + req.get('host') + req.originalUrl);
  }

  const config = await configBuilder.build();

  if (req.path.startsWith('/singbox')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(config, null, 2));
  } else if (req.path.startsWith('/clash')) {
    res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
    res.send(config);
  } else {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('subscription-userinfo', 'upload=0; download=0; total=10737418240; expire=2546249531');
    res.send(config);
  }
});

app.get('/shorten', (req, res) => {
  const originalUrl = req.query.url;
  if (!originalUrl) return res.status(400).send(t('missingUrl'));
  const shortCode = GenerateWebPath();
  kvPut(shortCode, originalUrl);
  const shortUrl = `${req.protocol}://${req.get('host')}/s/${shortCode}`;
  res.json({ shortUrl });
});

app.get('/shorten-v2', (req, res) => {
  const originalUrl = req.query.url;
  let shortCode = req.query.shortCode;
  if (!originalUrl) return res.status(400).send('Missing URL parameter');
  const parsedUrl = new URL(originalUrl);
  const queryString = parsedUrl.search;
  if (!shortCode) shortCode = GenerateWebPath();
  kvPut(shortCode, queryString);
  res.type('text/plain').send(shortCode);
});

app.get(['/b/:code', '/c/:code', '/x/:code', '/s/:code'], (req, res) => {
  const { code } = req.params;
  const originalParam = kvGet(code);
  let originalUrl = null;
  if (req.path.startsWith('/b/')) originalUrl = `${req.protocol}://${req.get('host')}/singbox${originalParam}`;
  else if (req.path.startsWith('/c/')) originalUrl = `${req.protocol}://${req.get('host')}/clash${originalParam}`;
  else if (req.path.startsWith('/x/')) originalUrl = `${req.protocol}://${req.get('host')}/xray${originalParam}`;
  else if (req.path.startsWith('/s/')) originalUrl = `${req.protocol}://${req.get('host')}/surge${originalParam}`;
  if (!originalUrl) return res.status(404).send(t('shortUrlNotFound'));
  res.redirect(302, originalUrl);
});

app.get('/favicon.ico', (req, res) => {
  res.redirect(301, 'https://cravatar.cn/avatar/9240d78bbea4cf05fb04f2b86f22b18d?s=160&d=retro&r=g');
});

app.post('/config', async (req, res) => {
  const { type, content } = req.body;
  const configId = `${type}_${GenerateWebPath(8)}`;
  try {
    let configString;
    if (type === 'clash') {
      if (typeof content === 'string' && (content.trim().startsWith('-') || content.includes(':'))) {
        const yamlConfig = yaml.load(content);
        configString = JSON.stringify(yamlConfig);
      } else {
        configString = typeof content === 'object' ? JSON.stringify(content) : content;
      }
    } else {
      configString = typeof content === 'object' ? JSON.stringify(content) : content;
    }
    JSON.parse(configString);
    kvPut(configId, configString, { expirationTtl: 60 * 60 * 24 * 30 });
    res.type('text/plain').send(configId);
  } catch (error) {
    res.status(400).type('text/plain').send(t('invalidFormat') + error.message);
  }
});

app.get('/resolve', (req, res) => {
  const shortUrl = req.query.url;
  if (!shortUrl) return res.status(400).send(t('missingUrl'));
  try {
    const urlObj = new URL(shortUrl);
    const pathParts = urlObj.pathname.split('/');
    if (pathParts.length < 3) return res.status(400).send(t('invalidShortUrl'));
    const prefix = pathParts[1];
    const shortCode = pathParts[2];
    if (!['b', 'c', 'x', 's'].includes(prefix)) return res.status(400).send(t('invalidShortUrl'));
    const originalParam = kvGet(shortCode);
    if (!originalParam) return res.status(404).send(t('shortUrlNotFound'));
    let originalUrl;
    if (prefix === 'b') originalUrl = `${req.protocol}://${req.get('host')}/singbox${originalParam}`;
    else if (prefix === 'c') originalUrl = `${req.protocol}://${req.get('host')}/clash${originalParam}`;
    else if (prefix === 'x') originalUrl = `${req.protocol}://${req.get('host')}/xray${originalParam}`;
    else if (prefix === 's') originalUrl = `${req.protocol}://${req.get('host')}/surge${originalParam}`;
    res.json({ originalUrl });
  } catch {
    res.status(400).send(t('invalidShortUrl'));
  }
});

app.use((req, res) => {
  res.status(404).send(t('notFound'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
}); 
