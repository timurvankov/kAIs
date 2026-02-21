import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchChannels,
  fetchChannel,
  fetchChannelMessages,
  type Channel,
  type ChannelMessage,
} from '@/lib/api';

const PHASE_COLORS: Record<string, string> = {
  Active: 'bg-green-500/20 text-green-300',
  Paused: 'bg-yellow-500/20 text-yellow-300',
  Error: 'bg-red-500/20 text-red-300',
};

function PhaseBadge({ phase }: { phase: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${PHASE_COLORS[phase] ?? 'bg-gray-700 text-gray-300'}`}>
      {phase}
    </span>
  );
}

function SchemaView({ schema }: { schema: unknown }) {
  if (!schema) return null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-gray-400 mb-2">Message Schema</h4>
      <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap overflow-auto max-h-48">
        {JSON.stringify(schema, null, 2)}
      </pre>
    </div>
  );
}

function MessageRow({ message }: { message: ChannelMessage }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-t border-gray-800">
      <div
        className="flex items-center gap-3 py-2 px-3 hover:bg-gray-800/50 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-xs text-gray-500 w-4">{expanded ? '\u25BC' : '\u25B6'}</span>
        <span className="text-xs text-gray-400 w-40">
          {new Date(message.timestamp).toLocaleString()}
        </span>
        <span className="text-sm font-mono text-blue-400">{message.from}</span>
        <span className="text-xs text-gray-600 font-mono ml-auto">{message.id.slice(0, 12)}</span>
      </div>
      {expanded && (
        <div className="px-3 pb-3 ml-7">
          <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap bg-gray-800 rounded p-3 max-h-48 overflow-auto">
            {typeof message.payload === 'string'
              ? message.payload
              : JSON.stringify(message.payload, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function ChannelDetailView({ channel }: { channel: Channel }) {
  const messagesQuery = useQuery({
    queryKey: ['channelMessages', channel.name],
    queryFn: () => fetchChannelMessages(channel.name, { limit: 50 }),
  });

  const messages = messagesQuery.data?.messages ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h3 className="text-xl font-bold text-white">{channel.name}</h3>
        <PhaseBadge phase={channel.status.phase} />
        <span className="text-xs text-gray-500">{channel.namespace}</span>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-white">{channel.status.messageCount}</div>
          <div className="text-xs text-gray-500">Messages</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-blue-400">{channel.status.subscriberCount}</div>
          <div className="text-xs text-gray-500">Subscribers</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-sm text-gray-300">
            {channel.spec.maxMessageSize >= 1024
              ? `${(channel.spec.maxMessageSize / 1024).toFixed(0)} KB`
              : `${channel.spec.maxMessageSize} B`}
          </div>
          <div className="text-xs text-gray-500">Max Message Size</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
          <div className="text-sm text-gray-300">{channel.spec.retentionMinutes}m</div>
          <div className="text-xs text-gray-500">Retention</div>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-gray-400 mb-2">Connected Formations</h4>
        <div className="flex flex-wrap gap-2">
          {channel.spec.formations.map((f) => (
            <span key={f} className="bg-gray-800 text-blue-400 px-2 py-1 rounded text-sm font-mono">
              {f}
            </span>
          ))}
        </div>
      </div>

      <SchemaView schema={channel.spec.schema} />

      {channel.status.lastMessageAt && (
        <div className="text-xs text-gray-500">
          Last message at: {new Date(channel.status.lastMessageAt).toLocaleString()}
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold text-gray-400 mb-3">Recent Messages</h4>
        {messagesQuery.isLoading && <p className="text-gray-400 text-sm">Loading messages...</p>}
        {messagesQuery.error && (
          <p className="text-red-400 text-sm">Error: {(messagesQuery.error as Error).message}</p>
        )}
        {messages.length > 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            {messages.map((msg) => (
              <MessageRow key={msg.id} message={msg} />
            ))}
          </div>
        ) : (
          !messagesQuery.isLoading && (
            <p className="text-gray-500 text-sm">No messages in this channel.</p>
          )
        )}
      </div>
    </div>
  );
}

export default function ChannelMessagesPage() {
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['channels'],
    queryFn: () => fetchChannels(),
  });

  const detailQuery = useQuery({
    queryKey: ['channel', selectedChannel],
    queryFn: () => fetchChannel(selectedChannel!),
    enabled: !!selectedChannel,
  });

  const channels = listQuery.data?.channels ?? [];

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Channels</h2>

      {listQuery.isLoading && <p className="text-gray-400">Loading channels...</p>}
      {listQuery.error && (
        <p className="text-red-400">Error: {(listQuery.error as Error).message}</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {channels.map((ch) => (
          <button
            key={ch.name}
            onClick={() => setSelectedChannel(ch.name === selectedChannel ? null : ch.name)}
            className={`text-left p-4 rounded-lg border transition-colors ${
              selectedChannel === ch.name
                ? 'bg-gray-800 border-blue-500'
                : 'bg-gray-900 border-gray-800 hover:border-gray-700'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-white">{ch.name}</span>
              <PhaseBadge phase={ch.status.phase} />
            </div>
            <div className="text-xs text-gray-500">
              {ch.status.messageCount} msgs &middot;{' '}
              {ch.status.subscriberCount} subs &middot;{' '}
              {ch.spec.formations.join(', ')}
            </div>
          </button>
        ))}
      </div>

      {!listQuery.isLoading && channels.length === 0 && (
        <p className="text-gray-500 text-sm">No channels found.</p>
      )}

      {selectedChannel && detailQuery.isLoading && (
        <p className="text-gray-400">Loading channel details...</p>
      )}
      {selectedChannel && detailQuery.error && (
        <p className="text-red-400">Error: {(detailQuery.error as Error).message}</p>
      )}
      {detailQuery.data && <ChannelDetailView channel={detailQuery.data} />}
    </div>
  );
}
