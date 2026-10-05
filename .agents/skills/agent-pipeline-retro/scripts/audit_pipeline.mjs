#!/usr/bin/env node
/**
 * Audit Flight Hunter GitHub Actions runs and summarize successes and failure patterns.
 * Usage: node .agents/skills/agent-pipeline-retro/scripts/audit_pipeline.mjs
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../../..');

async function getGitHubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const mcpConfigRaw = await readFile(resolve(repoRoot, '.agents/plugins/github/mcp_config.json'), 'utf8');
    const mcpConfig = JSON.parse(mcpConfigRaw);
    return mcpConfig.mcpServers?.github?.env?.GITHUB_PERSONAL_ACCESS_TOKEN || '';
  } catch {
    return '';
  }
}

async function fetchJson(url, token) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Flight-Hunter-Auditor',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

async function main() {
  const token = await getGitHubToken();
  if (!token) {
    console.error('Error: No se encontró GITHUB_PERSONAL_ACCESS_TOKEN.');
    process.exit(1);
  }

  const owner = 'Bomastulacio';
  const repo = 'FLY-HUNTER';
  const runsUrl = `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=10`;

  console.log(`\n🔍 Consultando corridas recientes de ${owner}/${repo}...\n`);
  const data = await fetchJson(runsUrl, token);
  const runs = data.workflow_runs || [];

  if (runs.length === 0) {
    console.log('No se encontraron corridas recientes.');
    return;
  }

  console.log('| ID | Workflow | Evento | Estado | Conclusión | Duración | URL |');
  console.log('|---|---|---|---|---|---|---|');

  for (const run of runs) {
    const duration = run.updated_at && run.run_started_at
      ? `${Math.round((new Date(run.updated_at) - new Date(run.run_started_at)) / 1000)}s`
      : '—';
    const icon = run.conclusion === 'success' ? '✅' : run.conclusion === 'failure' ? '❌' : '⏳';
    console.log(`| ${run.id} | ${run.name} | ${run.event} | ${run.status} | ${icon} ${run.conclusion || 'running'} | ${duration} | [Ver corrida](${run.html_url}) |`);
  }

  // Si hay algún fallo reciente, inspeccionar el log del job
  const failedRuns = runs.filter(r => r.conclusion === 'failure').slice(0, 2);
  if (failedRuns.length > 0) {
    console.log('\n⚠️ Análisis de fallos recientes detectados:\n');
    for (const failedRun of failedRuns) {
      console.log(`--- Corrida #${failedRun.id} (${failedRun.name}) ---`);
      try {
        const jobsData = await fetchJson(failedRun.jobs_url, token);
        for (const job of jobsData.jobs || []) {
          if (job.conclusion === 'failure') {
            console.log(`- Job fallido: "${job.name}" (ID: ${job.id})`);
            const failedStep = job.steps?.find(s => s.conclusion === 'failure');
            if (failedStep) {
              console.log(`  Paso con error: "${failedStep.name}"`);
            }
          }
        }
      } catch (err) {
        console.warn(`  No se pudieron obtener detalles de jobs: ${err.message}`);
      }
    }
  }

  console.log('\n💡 Consejo: Para codificar fallos en tests de regresión, consultá .agents/skills/agent-pipeline-retro/SKILL.md\n');
}

main().catch(err => {
  console.error('Fallo en la auditoría:', err.message);
  process.exit(1);
});
