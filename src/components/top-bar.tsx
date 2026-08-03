'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { PanelLeftIcon } from 'lucide-react'

export interface ModelOption {
    id: string
    name: string
}

interface TopBarProps {
    onToggleSidebar: () => void
    model: string
    onModelChange: (model: string) => void
    models: ModelOption[]
    title?: string
}

export function TopBar({
    onToggleSidebar,
    model,
    onModelChange,
    models,
    title,
}: TopBarProps) {
    return (
        <header className="flex h-12 items-center gap-2 border-b border-border bg-background px-3">
            <Button
                variant="ghost"
                size="icon-sm"
                onClick={onToggleSidebar}
                aria-label="切换侧边栏"
                className="md:hidden"
            >
                <PanelLeftIcon className="size-4" />
            </Button>

            <div className="min-w-0 flex-1 truncate text-sm font-medium">
                {title || 'ChatGPT'}
            </div>

            <div className="flex items-center gap-2">
                <Select
                    value={model}
                    onValueChange={(v: string | null) => {
                        if (v) onModelChange(v)
                    }}
                >
                    <SelectTrigger size="sm" className="h-8 w-[180px]">
                        <SelectValue placeholder="选择模型" />
                    </SelectTrigger>
                    <SelectContent>
                        {models.map(m => (
                            <SelectItem key={m.id} value={m.id}>
                                {m.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
        </header>
    )
}
