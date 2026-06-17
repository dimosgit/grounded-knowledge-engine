import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Command, FileText, ArrowRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { matchesSearchFields } from '../lib/search';

export function CommandBar({ items, isOpen, onOpenChange, onSelect }) {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);

    const filteredItems = useMemo(() => {
        if (!query) return [];
        return items
            .filter(item => matchesSearchFields(
                {
                    raw: item.searchIndex,
                    normalized: item.searchIndexNormalized,
                    compact: item.searchIndexCompact
                },
                query
            ))
            .slice(0, 20);
    }, [items, query]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                onOpenChange(true);
            }
            if (e.key === 'Escape') onOpenChange(false);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onOpenChange]);

    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    const handleKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => (prev + 1) % filteredItems.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => (prev - 1 + filteredItems.length) % filteredItems.length);
        } else if (e.key === 'Enter') {
            if (filteredItems[selectedIndex]) {
                onSelect(filteredItems[selectedIndex]);
                onOpenChange(false);
                setQuery('');
            }
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100]"
                        onClick={() => onOpenChange(false)}
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -20 }}
                        className="fixed left-1/2 top-[15%] z-[101] w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border border-border-subtle bg-surface-sidebar shadow-2xl"
                    >
                        <div className="flex items-center border-b border-border-subtle px-4 py-3">
                            <Search strokeWidth={2.4} className="mr-3 h-3.5 w-3.5 text-primary" />
                            <input
                                autoFocus
                                placeholder="Search notes, terms, commands..."
                                className="flex-1 border-none bg-transparent text-[13.5px] font-medium text-on-surface outline-none placeholder:text-on-surface-variant"
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                onKeyDown={handleKeyDown}
                            />
                            <div className="shortcut-keycap shortcut-keycap--compact" aria-hidden="true">
                                <Command size={11} strokeWidth={2.7} />
                                <span>K</span>
                            </div>
                        </div>

                        <div className="max-h-[400px] overflow-y-auto p-2">
                            {filteredItems.length > 0 ? (
                                filteredItems.map((item, index) => (
                                    <button
                                        key={item.path}
                                        className={cn(
                                            "flex w-full items-center justify-between rounded p-3 text-left transition-all",
                                            index === selectedIndex ? "bg-surface-container-high text-primary shadow-sm" : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
                                        )}
                                        onMouseEnter={() => setSelectedIndex(index)}
                                        onClick={() => {
                                            onSelect(item);
                                            onOpenChange(false);
                                            setQuery('');
                                        }}
                                    >
                                            <div className="flex items-center gap-3">
                                                <div className={cn(
                                                "rounded p-2",
                                                index === selectedIndex ? "bg-surface-sidebar" : "bg-surface-container"
                                            )}>
                                                    <FileText className="w-4 h-4" />
                                                </div>
                                            <div>
                                                <div className="font-bold text-sm leading-tight">{item.title}</div>
                                                <div className="text-[11px] opacity-70 mt-0.5">{item.path}</div>
                                            </div>
                                        </div>
                                        {index === selectedIndex && (
                                            <ArrowRight strokeWidth={2.8} className="mr-1 h-3.5 w-3.5 animate-in slide-in-from-left-2 text-primary" />
                                        )}
                                    </button>
                                ))
                            ) : query ? (
                                <div className="py-12 text-center text-sm text-on-surface-variant">
                                    No results for "{query}"
                                </div>
                            ) : (
                                <div className="py-8 text-center text-sm italic text-on-surface-variant">
                                    Start typing to search...
                                </div>
                            )}
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
