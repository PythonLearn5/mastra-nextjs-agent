
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { Observability, MastraStorageExporter, MastraPlatformExporter, SensitiveDataFilter } from '@mastra/observability';
import { weatherWorkflow } from './workflows/weather-workflow';
import { weatherAgent } from './agents/weather-agent';
import { machineToolAgent } from './agents/machine-tool-agent';
import { knowledgeBaseTool } from './tools/knowledge-base-tool';
import { findKnowledgeImagesTool } from './tools/find-knowledge-images-tool';

const dbUrl = process.env.TURSO_DATABASE_URL ?? 'file:./mastra.db';
const dbAuthToken = process.env.TURSO_AUTH_TOKEN;

export const mastra = new Mastra({
  workflows: { weatherWorkflow },
  agents: { weatherAgent, machineToolAgent },
  tools: { knowledgeBaseTool, findKnowledgeImagesTool },
  storage: new LibSQLStore({
    id: 'mastra-storage',
    url: dbUrl,
    authToken: dbAuthToken,
  }),
  vectors: {
    libsql: new LibSQLVector({
      id: 'mastra-vector',
      url: dbUrl,
      authToken: dbAuthToken,
    }),
  },
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new MastraStorageExporter(),
          new MastraPlatformExporter(),
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(),
        ],
      },
    },
  }),
});
