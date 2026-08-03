'use client'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    PlusIcon,
    MessageSquareIcon,
    Trash2Icon,
    PanelLeftCloseIcon,
    PanelLeftIcon,
    MoreHorizontalIcon,
} from 'lucide-react'

export interface ChatThread {
    id: string
    title?: string
    createdAt: string
    updatedAt: string
}

interface AppSidebarProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    threads: ChatThread[]
    activeThreadId: string | null
    onSelectThread: (id: string) => void
    onNewThread: () => void
    onDeleteThread: (id: string) => void
}

export function AppSidebar({
    open,
    onOpenChange,
    threads,
    activeThreadId,
    onSelectThread,
    onNewThread,
    onDeleteThread,
}: AppSidebarProps) {
    return (
        <>
            {open && (
                <div
                    className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm md:hidden"
                    onClick={() => onOpenChange(false)}
                />
            )}
            <aside
                className={cn(
                    'fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col border-r border-border bg-sidebar transition-transform duration-200 md:static md:translate-x-0',
                    open ? 'translate-x-0' : '-translate-x-full'
                )}
            >
                <div className="flex items-center gap-2 p-2">
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => onOpenChange(false)}
                        className="hidden md:flex"
                        aria-label="收起侧边栏"
                    >
                        <PanelLeftCloseIcon className="size-4" />
                    </Button>
                    <Button
                        variant="outline"
                        className="flex-1 justify-start gap-2"
                        onClick={() => {
                            onNewThread()
                            onOpenChange(false)
                        }}
                    >
                        <PlusIcon className="size-4" />
                        新对话
                    </Button>
                </div>

                <div className="flex-1 overflow-y-auto px-2 pb-2">
                    {threads.length === 0 ? (
                        <div className="px-3 py-8 text-center text-muted-foreground text-sm">
                            暂无历史会话
                        </div>
                    ) : (
                        <ul className="space-y-1">
                            {threads.map(thread => {
                                const active = thread.id === activeThreadId
                                return (
                                    <li key={thread.id}>
                                        <div
                                            className={cn(
                                                'group flex items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors',
                                                active
                                                    ? 'bg-accent text-accent-foreground'
                                                    : 'hover:bg-accent/50'
                                            )}
                                        >
                                            <button
                                                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                                onClick={() => {
                                                    onSelectThread(thread.id)
                                                    onOpenChange(false)
                                                }}
                                            >
                                                <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />
                                                <span className="truncate">
                                                    {thread.title || '新对话'}
                                                </span>
                                            </button>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger
                                                    render={
                                                        <Button
                                                            variant="ghost"
                                                            size="icon-sm"
                                                            className="size-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                                                            aria-label="更多操作"
                                                        >
                                                            <MoreHorizontalIcon className="size-4" />
                                                        </Button>
                                                    }
                                                />
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem
                                                        variant="destructive"
                                                        onClick={() =>
                                                            onDeleteThread(thread.id)
                                                        }
                                                    >
                                                        <Trash2Icon className="size-4" />
                                                        删除
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    </li>
                                )
                            })}
                        </ul>
                    )}
                </div>

                {!open && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onOpenChange(true)}
                        className="m-2 hidden md:flex"
                    >
                        <PanelLeftIcon className="size-4" />
                        展开
                    </Button>
                )}
            </aside>
        </>
    )
}
