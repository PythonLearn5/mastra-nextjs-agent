import { NextResponse } from 'next/server'

const AVAILABLE_MODELS = [
  { id: 'zhipuai/glm-5.2', name: 'GLM 5.2（智谱）' },
  { id: 'zhipuai/glm-4-flash', name: 'GLM 4 Flash（智谱·轻量）' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini（OpenAI）' },
]

export async function GET() {
  return NextResponse.json({ models: AVAILABLE_MODELS })
}
