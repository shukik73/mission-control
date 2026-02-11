import React, { useState } from 'react';
import { Agent, STREAMS } from '../types';
import { Activity, Radio, PauseCircle, Clock, Filter } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface AgentSidebarProps {
  agents: Agent[];
}

export const AgentSidebar: React.FC<AgentSidebarProps> = ({ agents }) => {
  const [selectedStream, setSelectedStream] = useState<string>('All Streams');

  const getStatusColor = (lastActive: Date) => {
    const now = new Date();
    const diffMins = (now.getTime() - lastActive.getTime()) / 60000;

    if (diffMins < 15) return 'text-emerald-500';
    if (diffMins < 60) return 'text-yellow-500';
    return 'text-rose-500';
  };

  const getStatusIcon = (lastActive: Date) => {
    const now = new Date();
    const diffMins = (now.getTime() - lastActive.getTime()) / 60000;

    if (diffMins < 15) return <Activity size={14} className="animate-pulse" />;
    if (diffMins < 60) return <Clock size={14} />;
    return <PauseCircle size={14} />;
  };

  const filteredAgents = selectedStream === 'All Streams'
    ? agents
    : agents.filter(a => a.currentStream === selectedStream);

  return (
    <div className="w-full md:w-72 bg-surface border-r border-border flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border bg-background/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center justify-between mb-4">
            <h2 className="text-primary font-bold flex items-center tracking-tight">
            <Radio className="mr-2 text-indigo-500" size={18} />
            AGENTS
            </h2>
            <span className="text-xs bg-surfaceHighlight text-secondary px-2 py-0.5 rounded-full font-mono">
                {filteredAgents.length}
            </span>
        </div>

        {/* Stream Filter */}
        <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                <Filter size={12} className="text-secondary" />
            </div>
            <select
                value={selectedStream}
                onChange={(e) => setSelectedStream(e.target.value)}
                className="w-full bg-background text-xs text-primary border border-border rounded pl-8 pr-2 py-2 appearance-none focus:outline-none focus:border-indigo-500 cursor-pointer hover:bg-surfaceHighlight transition-colors"
            >
                {STREAMS.map(stream => (
                    <option key={stream} value={stream}>{stream}</option>
                ))}
            </select>
        </div>
      </div>

      {/* Agents List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {filteredAgents.map(agent => {
            const statusColor = getStatusColor(agent.lastActive);

            return (
                <div key={agent.id} className="bg-surfaceHighlight hover:bg-accent border border-border rounded-lg p-3 transition-colors group cursor-default">
                    <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center">
                            <div className={`w-2 h-2 rounded-full mr-2 ${statusColor.replace('text-', 'bg-')} shadow-[0_0_8px_rgba(0,0,0,0.5)]`} />
                            <span className="text-sm font-medium text-primary">{agent.name}</span>
                        </div>
                        <div className={`${statusColor}`} title="Status">
                            {getStatusIcon(agent.lastActive)}
                        </div>
                    </div>

                    <div className="flex justify-between text-xs text-secondary font-mono mb-2">
                        <span>{agent.dealsFound} found</span>
                        <span>{agent.dealsPending} pending</span>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-border">
                        <span className="text-[10px] text-secondary uppercase tracking-wider flex items-center">
                            <Clock size={10} className="mr-1" />
                            {formatDistanceToNow(agent.lastActive, { addSuffix: true })}
                        </span>
                         <span className="text-[10px] bg-surfaceHighlight text-secondary px-1.5 py-0.5 rounded truncate max-w-[100px]">
                            {agent.currentStream}
                        </span>
                    </div>
                </div>
            );
        })}
      </div>
    </div>
  );
};
