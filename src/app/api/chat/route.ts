import { handleChatStream } from '@mastra/ai-sdk'
import { toAISdkMessages } from '@mastra/ai-sdk/ui'
import { createUIMessageStreamResponse } from 'ai'
import { mastra } from '@/mastra'
import { NextResponse } from 'next/server'

const RESOURCE_ID = 'weather-chat'

export async function GET(req: Request) {
    try {
        const memory = await mastra.getAgentById('weather-agent').getMemory()

        const { searchParams } = new URL(req.url)
        const threadId = searchParams.get('threadId') ?? ''

        let response = null
        if (memory && threadId) {
            try {
                response = await memory.recall({
                    threadId,
                    resourceId: RESOURCE_ID,
                })
            } catch {
                console.log('No previous messages found.')
            }
        }

        const uiMessages = toAISdkMessages(response?.messages || [], {
            version: 'v6',
        })

        return NextResponse.json(uiMessages)
    } catch (err) {
        console.error('[GET /api/chat] error:', err)
        return NextResponse.json(
            { error: err instanceof Error ? err.message : String(err) },
            { status: 500 }
        )
    }
}

export async function POST(req: Request) {
    try {
        const params = await req.json()
        const threadId = params?.threadId ?? params?.memory?.thread ?? ''
        const model = params?.model as string | undefined

        const stream = await handleChatStream({
            mastra,
            agentId: 'weather-agent',
            version: 'v6',
            params: {
                ...params,
                ...(model ? { model } : {}),
                memory: {
                    ...params?.memory,
                    thread: threadId,
                    resource: RESOURCE_ID,
                },
            },
        })
        return createUIMessageStreamResponse({ stream })
    } catch (err) {
        console.error('[POST /api/chat] error:', err)
        return NextResponse.json(
            { error: err instanceof Error ? err.message : String(err) },
            { status: 500 }
        )
    }
}
