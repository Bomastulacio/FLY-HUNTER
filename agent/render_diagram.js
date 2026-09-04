import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function render() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 900, height: 1200 },
    deviceScaleFactor: 2 // High resolution Retina
  });

  const htmlPath = path.join(__dirname, 'render_diagram.html');
  await page.goto(`file://${htmlPath}`);
  
  const element = await page.$('.canvas');
  const targetPath = path.join(__dirname, '..', 'diagrama_agentes.png');
  
  if (element) {
    await element.screenshot({ path: targetPath });
    console.log(`✅ Diagrama generado con éxito en: ${targetPath}`);
  } else {
    await page.screenshot({ path: targetPath, fullPage: true });
    console.log(`✅ Captura completa guardada en: ${targetPath}`);
  }

  await browser.close();
}

render().catch(err => {
  console.error('Error renderizando diagrama:', err);
  process.exit(1);
});
