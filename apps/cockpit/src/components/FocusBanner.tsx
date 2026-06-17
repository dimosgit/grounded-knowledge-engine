import React from 'react';
import { motion } from 'framer-motion';
import { Zap, ArrowRight } from 'lucide-react';

export function FocusBanner({ moduleTitle, actions = [], blockers = [], onClick }) {
    if (!moduleTitle) return null;

    return (
        <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative overflow-hidden rounded-xl bg-white border border-slate-200/60 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] mb-10 group cursor-pointer hover:border-teal-500/30 transition-all duration-300"
            onClick={onClick}
        >
            {/* High-visibility Color Bar */}
            <div className="absolute top-0 left-0 w-1.5 h-full bg-teal-500 shadow-[0_0_15px_rgba(20,184,166,0.3)]" />

            <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-8">
                <div className="flex-1">
                    <div className="flex items-center gap-2 text-teal-600 font-bold tracking-tight text-[11px] uppercase mb-2">
                        <Zap className="w-3.5 h-3.5 fill-current" />
                        Active Module
                    </div>
                    <h2 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight mb-6">
                        {moduleTitle}
                    </h2>

                    <div className="flex flex-wrap gap-4">
                        {actions.length > 0 && (
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-lg border border-slate-100 shadow-sm">
                                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Tasks</span>
                                <span className="w-5 h-5 flex items-center justify-center bg-teal-500 text-white text-[10px] font-black rounded-md">
                                    {actions.length}
                                </span>
                            </div>
                        )}
                        {blockers.length > 0 && (
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50/50 rounded-lg border border-red-100 shadow-sm">
                                <span className="text-[11px] font-bold text-red-500 uppercase tracking-widest">Blockers</span>
                                <span className="w-5 h-5 flex items-center justify-center bg-red-600 text-white text-[10px] font-black rounded-md">
                                    {blockers.length}
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex-shrink-0">
                    <button type="button" className="hub-quick-search-btn continue-learning-btn">
                        <span className="hub-quick-search-icon continue-learning-icon" aria-hidden="true">
                            <Zap size={14} strokeWidth={2.8} />
                        </span>
                        <span className="hub-quick-search-label">Continue Learning</span>
                        <span className="shortcut-keycap continue-learning-keycap" aria-hidden="true">
                            <ArrowRight size={13} strokeWidth={3} />
                        </span>
                    </button>
                </div>
            </div>
        </motion.div>
    );
}
