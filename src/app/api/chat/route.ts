import { handleChatStream } from '@mastra/ai-sdk'
import { toAISdkMessages } from '@mastra/ai-sdk/ui'
import { createUIMessageStreamResponse, type UIMessageChunk } from 'ai'
import { mastra } from '@/mastra'
import { NextResponse } from 'next/server'
import {
    backfillUIMessageText,
    createKnowledgeAnchorTransform,
} from '@/lib/knowledge-store'

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

        const uiMessages = backfillUIMessageText(
            toAISdkMessages(response?.messages || [], {
                version: 'v6',
            }) as object[]
        )

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

        // 服务端把回复中的 ⟦img:ID⟧ 锚点回填为 Markdown 图片（跨 delta 安全）
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
        return createUIMessageStreamResponse({
            stream: stream.pipeThrough(createKnowledgeAnchorTransform<UIMessageChunk>()),
        })
    } catch (err) {
        console.error('[POST /api/chat] error:', err)
        return NextResponse.json(
            { error: err instanceof Error ? err.message : String(err) },
            { status: 500 }
        )
    }
}
