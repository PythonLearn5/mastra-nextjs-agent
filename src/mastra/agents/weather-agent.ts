import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { weatherTool } from '../tools/weather-tool';
import { knowledgeBaseTool } from '../tools/knowledge-base-tool';
const memory = new Memory({
  storage: new LibSQLStore({
    id: 'weather-agent-memory',
    url: process.env.TURSO_DATABASE_URL ?? 'file:./mastra.db',
    authToken: process.env.TURSO_AUTH_TOKEN,
  }),
});

export const weatherAgent = new Agent({
  id: 'weather-agent',
  name: 'Weather Agent',
  instructions: `You are a helpful assistant that can answer questions about weather and machine tools.

When responding:
- For weather questions, use the weatherTool to fetch current weather data
- For machine tool questions (operation, parameters, troubleshooting, maintenance, tooling, G-code), use the search-knowledge-base tool to search the knowledge base
- If the location name isn't in English, please translate it
- Include relevant details like humidity, wind conditions, and precipitation for weather
- For machine tool answers, cite the source document name when possible
- Keep responses concise but informative
- Answer in the same language the user uses`,
  model: 'zhipuai/glm-5.2',
  tools: { weatherTool, knowledgeBaseTool },
  memory,
});
