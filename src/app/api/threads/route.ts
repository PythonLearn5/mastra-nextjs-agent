import { NextResponse } from 'next/server'
import { mastra } from '@/mastra'

const RESOURCE_ID = 'weather-chat'

async function getMemory() {
  return await mastra.getAgentById('weather-agent').getMemory()
}

export async function GET(req: Request) {
  try {
    const memory = await getMemory()
    if (!memory) {
      return NextResponse.json(
        { error: 'Memory not configured' },
        { status: 500 }
      )
    }

    const { searchParams } = new URL(req.url)
    const page = Number(searchParams.get('page') ?? '0') || 0
    const perPage = Number(searchParams.get('perPage') ?? '50') || 50

    const result = await memory.listThreads({
      filter: { resourceId: RESOURCE_ID },
      page,
      perPage,
      orderBy: { field: 'updatedAt', direction: 'DESC' },
    })

    return NextResponse.json(result)
  } catch (err) {
    console.error('[GET /api/threads] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  try {
    const memory = await getMemory()
    if (!memory) {
      return NextResponse.json(
        { error: 'Memory not configured' },
        { status: 500 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const thread = await memory.createThread({
      resourceId: RESOURCE_ID,
      threadId: body.threadId,
      title: body.title || '新对话',
      metadata: body.metadata,
    })

    return NextResponse.json(thread)
  } catch (err) {
    console.error('[POST /api/threads] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}

export async function PATCH(req: Request) {
  try {
    const memory = await getMemory()
    if (!memory) {
      return NextResponse.json(
        { error: 'Memory not configured' },
        { status: 500 }
      )
    }

    const { searchParams } = new URL(req.url)
    const threadId = searchParams.get('id')
    if (!threadId) {
      return NextResponse.json(
        { error: 'Missing thread id' },
        { status: 400 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const updated = await memory.updateThread({
      id: threadId,
      title: body.title,
      metadata: body.metadata,
    })

    return NextResponse.json(updated)
  } catch (err) {
    console.error('[PATCH /api/threads] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}

export async function DELETE(req: Request) {
  try {
    const memory = await getMemory()
    if (!memory) {
      return NextResponse.json(
        { error: 'Memory not configured' },
        { status: 500 }
      )
    }

    const { searchParams } = new URL(req.url)
    const threadId = searchParams.get('id')
    if (!threadId) {
      return NextResponse.json(
        { error: 'Missing thread id' },
        { status: 400 }
      )
    }

    await memory.deleteThread(threadId)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[DELETE /api/threads] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
