'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { DefaultChatTransport, ToolUIPart } from 'ai'
import { useChat } from '@ai-sdk/react'
import { cn } from '@/lib/utils'
import { GlobeIcon, ImageIcon, MicIcon, PaperclipIcon, SquareIcon } from 'lucide-react'

import {
    PromptInput,
    PromptInputActionMenu,
    PromptInputActionMenuContent,
    PromptInputActionMenuItem,
    PromptInputActionMenuTrigger,
    PromptInputBody,
    PromptInputButton,
    PromptInputSubmit,
    PromptInputTextarea,
    usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input'

import {
    Conversation,
    ConversationContent,
    ConversationScrollButton,
} from '@/components/ai-elements/conversation'

import { MessageResponse } from '@/components/ai-elements/message'

import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from '@/components/ai-elements/tool'

interface ChatPanelProps {
    threadId: string
    model: string
    onTitleUpdate?: (title: string) => void
}

interface SpeechRecognition extends EventTarget {
    continuous: boolean
    interimResults: boolean
    lang: string
    start(): void
    stop(): void
    onstart: ((this: SpeechRecognition, ev: Event) => void) | null
    onend: ((this: SpeechRecognition, ev: Event) => void) | null
    onresult: ((this: SpeechRecognition, ev: Event) => void) | null
    onerror: ((this: SpeechRecognition, ev: Event) => void) | null
}

declare global {
    interface Window {
        SpeechRecognition: new () => SpeechRecognition
        webkitSpeechRecognition: new () => SpeechRecognition
    }
}

function PromptActionMenu() {
    const attachments = usePromptInputAttachments()

    return (
        <PromptInputActionMenu>
            <PromptInputActionMenuTrigger tooltip="添加" />
            <PromptInputActionMenuContent className="min-w-72">
                <PromptInputActionMenuItem onClick={attachments.openFileDialog}>
                    <PaperclipIcon className="size-4" />
                    添加照片和文件
                </PromptInputActionMenuItem>
                <PromptInputActionMenuItem disabled>
                    <ImageIcon className="size-4" />
                    创建图片
                </PromptInputActionMenuItem>
                <PromptInputActionMenuItem disabled>
                    <GlobeIcon className="size-4" />
                    网络搜索
                </PromptInputActionMenuItem>
            </PromptInputActionMenuContent>
        </PromptInputActionMenu>
    )
}

export function ChatPanel({ threadId, model, onTitleUpdate }: ChatPanelProps) {
    const [input, setInput] = useState<string>('')
    const [isListening, setIsListening] = useState(false)
    const [isSpeechSupported, setIsSpeechSupported] = useState(false)
    const recognitionRef = useRef<SpeechRecognition | null>(null)

    const { messages, setMessages, sendMessage, status, stop } = useChat({
        transport: new DefaultChatTransport({
            api: '/api/chat',
            body: { threadId, model },
        }),
    })

    useEffect(() => {
        let active = true
        const fetchMessages = async () => {
            setMessages([])
            try {
                const res = await fetch(`/api/chat?threadId=${encodeURIComponent(threadId)}`)
                if (!res.ok) return
                const data = await res.json()
                if (active && Array.isArray(data)) {
                    setMessages([...data])
                }
            } catch (err) {
                console.error('[GET /api/chat] error:', err)
            }
        }
        fetchMessages()
        return () => {
            active = false
        }
    }, [threadId, setMessages])

    useEffect(() => {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition
        if (!SR) {
            setIsSpeechSupported(false)
            return
        }
        setIsSpeechSupported(true)

        const recognition = new SR()
        recognition.continuous = false
        recognition.interimResults = false
        recognition.lang = 'zh-CN'

        const handleStart = () => setIsListening(true)
        const handleEnd = () => setIsListening(false)
        const handleError = () => setIsListening(false)
        const handleResult = (event: Event) => {
            const speechEvent = event as unknown as {
                results: ArrayLike<ArrayLike<{ transcript: string }>>
            }
            const transcript = speechEvent?.results?.[0]?.[0]?.transcript
            if (!transcript) return
            setInput(prev => (prev ? `${prev}${transcript}` : transcript))
        }

        recognition.addEventListener('start', handleStart)
        recognition.addEventListener('end', handleEnd)
        recognition.addEventListener('error', handleError)
        recognition.addEventListener('result', handleResult)
        recognitionRef.current = recognition

        return () => {
            recognition.removeEventListener('start', handleStart)
            recognition.removeEventListener('end', handleEnd)
            recognition.removeEventListener('error', handleError)
            recognition.removeEventListener('result', handleResult)
            recognition.stop()
            recognitionRef.current = null
        }
    }, [])

    const toggleMic = useCallback(() => {
        if (!recognitionRef.current) return
        if (isListening) {
            recognitionRef.current.stop()
            return
        }
        recognitionRef.current.start()
    }, [isListening])

    const handleSubmit = useCallback(
        async ({ text }: { text: string }) => {
            if (!text.trim()) return
            setInput('')
            if (onTitleUpdate) onTitleUpdate(text.slice(0, 20))
            try {
                await sendMessage({ text })
            } catch (err) {
                console.error('[sendMessage] error:', err)
            }
        },
        [sendMessage, onTitleUpdate]
    )

    return (
        <div className="flex h-full w-full flex-col bg-background">
            <div className="flex-1 overflow-hidden">
                <Conversation className="h-full">
                    <ConversationContent className="gap-0 p-0 pb-32">
                        {messages.map(message => {
                            const userText = message.parts
                                ?.filter(part => part.type === 'text')
                                .map(part => part.text)
                                .join('')

                            if (message.role === 'user') {
                                return (
                                    <div
                                        key={message.id}
                                        className="w-full border-b border-border/50"
                                    >
                                        <div className="mx-auto flex w-full max-w-3xl justify-end px-4 py-6">
                                            <div className="max-w-[85%] rounded-2xl bg-secondary px-4 py-3 text-sm text-foreground">
                                                <MessageResponse>{userText}</MessageResponse>
                                            </div>
                                        </div>
                                    </div>
                                )
                            }

                            return (
                                <div
                                    key={message.id}
                                    className={cn(
                                        'w-full border-b border-border/50 bg-muted/30',
                                        message.role === 'assistant' ? 'bg-muted/30' : 'bg-background'
                                    )}
                                >
                                    <div className="mx-auto flex w-full max-w-3xl gap-4 px-4 py-6">
                                        <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
                                            GPT
                                        </div>
                                        <div className="min-w-0 flex-1 space-y-4">
                                            {message.parts?.map((part, i) => {
                                                if (part.type === 'text') {
                                                    return (
                                                        <MessageResponse key={`${message.id}-${i}`}>
                                                            {part.text}
                                                        </MessageResponse>
                                                    )
                                                }

                                                if (part.type?.startsWith('tool-')) {
                                                    return (
                                                        <Tool key={`${message.id}-${i}`}>
                                                            <ToolHeader
                                                                type={(part as ToolUIPart).type}
                                                                state={
                                                                    (part as ToolUIPart).state ||
                                                                    'output-available'
                                                                }
                                                                className="cursor-pointer"
                                                            />
                                                            <ToolContent>
                                                                <ToolInput
                                                                    input={
                                                                        (part as ToolUIPart)
                                                                            .input || {}
                                                                    }
                                                                />
                                                                <ToolOutput
                                                                    output={
                                                                        (part as ToolUIPart)
                                                                            .output
                                                                    }
                                                                    errorText={
                                                                        (part as ToolUIPart)
                                                                            .errorText
                                                                    }
                                                                />
                                                            </ToolContent>
                                                        </Tool>
                                                    )
                                                }

                                                return null
                                            })}
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                        <ConversationScrollButton className="bottom-28" />
                    </ConversationContent>
                </Conversation>
            </div>

            <div className="sticky bottom-0 w-full bg-background/80 backdrop-blur">
                <div className="mx-auto w-full max-w-3xl px-4 py-4">
                    <PromptInput
                        onSubmit={handleSubmit}
                        className="w-full"
                    >
                        <PromptInputBody>
                            <div className="flex items-center pl-2">
                                <PromptActionMenu />
                            </div>
                            <PromptInputTextarea
                                onChange={e => setInput(e.target.value)}
                                value={input}
                                placeholder="有问题，尽管问"
                                className="py-3 text-[15px] leading-6"
                                disabled={status !== 'ready'}
                            />
                            <PromptInputButton
                                className="m-2"
                                tooltip="语音输入"
                                onClick={toggleMic}
                                disabled={!isSpeechSupported || status !== 'ready'}
                            >
                                {isListening ? (
                                    <SquareIcon className="size-4" />
                                ) : (
                                    <MicIcon className="size-4" />
                                )}
                            </PromptInputButton>
                            {(status !== 'ready' || input.trim().length > 0) && (
                                <PromptInputSubmit
                                    status={status}
                                    onStop={stop}
                                    className="m-2"
                                />
                            )}
                        </PromptInputBody>
                    </PromptInput>
                </div>
            </div>
        </div>
    )
}
