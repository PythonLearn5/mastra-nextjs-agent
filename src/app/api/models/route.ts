import { NextResponse } from 'next/server'

const AVAILABLE_MODELS = [
  { id: 'alibaba-cn/qwen3.8-flash', name: 'Qwen3.8 Flash（通义·多模态）' },
  { id: 'alibaba-cn/qwen-flash', name: 'Qwen Flash（通义·轻量）' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini（OpenAI）' },
]

export async function GET() {
  return NextResponse.json({ models: AVAILABLE_MODELS })
}
