'use client'

import { useState, useEffect, useCallback } from 'react'
import { nanoid } from 'nanoid'
import { AppSidebar, type ChatThread } from '@/components/app-sidebar'
import { TopBar, type ModelOption } from '@/components/top-bar'
import { ChatPanel } from '@/components/chat-panel'

const DEFAULT_MODEL = 'alibaba-cn/qwen3.8-flash'

interface ChatShellProps {
    models?: ModelOption[]
    initialThreadId?: string
}

export function ChatShell({ models, initialThreadId }: ChatShellProps) {
    const [sidebarOpen, setSidebarOpen] = useState(true)
    const [threads, setThreads] = useState<ChatThread[]>([])
    const [activeThreadId, setActiveThreadId] = useState<string | null>(
        initialThreadId ?? null
    )
    const [model, setModel] = useState<string>(DEFAULT_MODEL)
    const [availableModels, setAvailableModels] = useState<ModelOption[]>(
        models ?? []
    )

    useEffect(() => {
        if (models?.length) {
            setAvailableModels(models)
            return
        }
        fetch('/api/models')
            .then(r => r.json())
            .then(data => {
                if (data?.models?.length) {
                    setAvailableModels(data.models)
                }
            })
            .catch(() => {})
    }, [models])

    const refreshThreads = useCallback(async () => {
        try {
            const res = await fetch('/api/threads')
            if (!res.ok) return
            const data = await res.json()
            setThreads(data.threads ?? [])
        } catch (err) {
            console.error('[refreshThreads] error:', err)
        }
    }, [])

    useEffect(() => {
        refreshThreads()
    }, [refreshThreads])

    const handleNewThread = useCallback(async () => {
        const id = nanoid()
        const now = new Date().toISOString()
        const newThread: ChatThread = {
            id,
            title: '新对话',
            createdAt: now,
            updatedAt: now,
        }
        setThreads(prev => [newThread, ...prev])
        setActiveThreadId(id)
        try {
            await fetch('/api/threads', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ threadId: id, title: '新对话' }),
            })
            await refreshThreads()
        } catch (err) {
            console.error('[handleNewThread] error:', err)
        }
    }, [refreshThreads])

    const handleDeleteThread = useCallback(
        async (id: string) => {
            const prevThreads = threads
            setThreads(prev => prev.filter(t => t.id !== id))
            if (activeThreadId === id) {
                const next = prevThreads.find(t => t.id !== id)
                setActiveThreadId(next?.id ?? null)
            }
            try {
                await fetch(`/api/threads?id=${encodeURIComponent(id)}`, {
                    method: 'DELETE',
                })
                await refreshThreads()
            } catch (err) {
                console.error('[handleDeleteThread] error:', err)
            }
        },
        [threads, activeThreadId, refreshThreads]
    )

    const handleSelectThread = useCallback((id: string) => {
        setActiveThreadId(id)
    }, [])

    const handleTitleUpdate = useCallback(
        (title: string) => {
            if (!activeThreadId) return
            setThreads(prev =>
                prev.map(t =>
                    t.id === activeThreadId && (!t.title || t.title === '新对话')
                        ? { ...t, title, updatedAt: new Date().toISOString() }
                        : t
                )
            )
            fetch(
                `/api/threads?id=${encodeURIComponent(activeThreadId)}`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title }),
                }
            ).catch(() => {})
        },
        [activeThreadId]
    )

    const activeThread = threads.find(t => t.id === activeThreadId)

    return (
        <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
            <AppSidebar
                open={sidebarOpen}
                onOpenChange={setSidebarOpen}
                threads={threads}
                activeThreadId={activeThreadId}
                onSelectThread={handleSelectThread}
                onNewThread={handleNewThread}
                onDeleteThread={handleDeleteThread}
            />
            <div className="flex min-w-0 flex-1 flex-col">
                <TopBar
                    onToggleSidebar={() => setSidebarOpen(o => !o)}
                    model={model}
                    onModelChange={setModel}
                    models={availableModels}
                    title={activeThread?.title}
                />
                <div className="min-h-0 flex-1">
                    {activeThreadId ? (
                        <ChatPanel
                            key={activeThreadId}
                            threadId={activeThreadId}
                            model={model}
                            onTitleUpdate={handleTitleUpdate}
                        />
                    ) : (
                        <div className="flex h-full items-center justify-center text-muted-foreground">
                            <div className="text-center">
                                <p className="text-sm">选择左侧会话或</p>
                                <button
                                    className="mt-2 text-sm font-medium text-foreground underline underline-offset-4"
                                    onClick={handleNewThread}
                                >
                                    新建对话
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
