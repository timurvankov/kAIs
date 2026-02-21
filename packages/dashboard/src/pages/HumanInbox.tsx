import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchHumanMessages, replyToHumanMessage, type HumanMessage } from '@/lib/api';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-300',
  replied: 'bg-green-500/20 text-green-300',
  expired: 'bg-red-500/20 text-red-300',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'text-gray-400',
  normal: 'text-blue-400',
  high: 'text-yellow-400',
  urgent: 'text-red-400',
};

function MessageCard({
  message,
  onReply,
  isLoading,
}: {
  message: HumanMessage;
  onReply: (reply: string) => void;
  isLoading: boolean;
}) {
  const [replyText, setReplyText] = useState('');
  const [showReplyForm, setShowReplyForm] = useState(false);

  const handleSubmitReply = () => {
    if (replyText.trim()) {
      onReply(replyText.trim());
      setReplyText('');
      setShowReplyForm(false);
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[message.status] ?? 'bg-gray-700 text-gray-300'}`}>
              {message.status}
            </span>
            <span className={`text-xs font-medium ${PRIORITY_COLORS[message.priority] ?? 'text-gray-400'}`}>
              {message.priority}
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-1">
            From <span className="text-blue-400 font-mono">{message.fromCell}</span>
            {' '}in <span className="text-gray-400">{message.namespace}</span>
            {' '}&middot; {new Date(message.createdAt).toLocaleString()}
          </div>
        </div>
        <span className="text-xs text-gray-600 font-mono">{message.id.slice(0, 8)}</span>
      </div>

      <div className="bg-gray-800 rounded p-3 mb-3">
        <div className="text-sm text-white whitespace-pre-wrap">{message.content}</div>
      </div>

      {message.context && (
        <div className="bg-gray-800/50 rounded p-3 mb-3">
          <div className="text-xs text-gray-500 mb-1">Context</div>
          <div className="text-xs text-gray-400">{message.context}</div>
        </div>
      )}

      {message.escalation && (
        <div className="text-xs text-gray-500 mb-3">
          Escalation: timeout {message.escalation.timeoutMinutes}m, action: {message.escalation.action}
        </div>
      )}

      {message.status === 'replied' && message.reply && (
        <div className="bg-green-500/10 border border-green-800 rounded p-3 mb-3">
          <div className="text-xs text-green-400 mb-1">Your Reply</div>
          <div className="text-sm text-gray-300">{message.reply}</div>
          {message.repliedAt && (
            <div className="text-xs text-gray-600 mt-1">
              Replied at {new Date(message.repliedAt).toLocaleString()}
            </div>
          )}
        </div>
      )}

      {message.status === 'pending' && (
        <div className="mt-3">
          {!showReplyForm ? (
            <button
              onClick={() => setShowReplyForm(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm"
            >
              Reply
            </button>
          ) : (
            <div className="space-y-2">
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Type your reply..."
                rows={3}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-y"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSubmitReply}
                  disabled={isLoading || !replyText.trim()}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded text-sm"
                >
                  Send Reply
                </button>
                <button
                  onClick={() => {
                    setShowReplyForm(false);
                    setReplyText('');
                  }}
                  className="text-gray-400 hover:text-white px-3 py-2 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function HumanInbox() {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['humanMessages', statusFilter],
    queryFn: () => fetchHumanMessages(statusFilter ? { status: statusFilter } : undefined),
  });

  const replyMut = useMutation({
    mutationFn: ({ id, reply }: { id: string; reply: string }) => replyToHumanMessage(id, reply),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['humanMessages'] }),
  });

  const messages = query.data?.messages ?? [];
  const pendingCount = messages.filter((m) => m.status === 'pending').length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">
          Human Inbox
          {pendingCount > 0 && (
            <span className="ml-2 text-sm font-normal bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded">
              {pendingCount} pending
            </span>
          )}
        </h2>
      </div>

      <div className="flex gap-2 mb-6">
        {['', 'pending', 'replied', 'expired'].map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`px-3 py-1.5 rounded text-sm ${
              statusFilter === status
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}
          >
            {status || 'All'}
          </button>
        ))}
      </div>

      {query.isLoading && <p className="text-gray-400">Loading messages...</p>}
      {query.error && (
        <p className="text-red-400">Error: {(query.error as Error).message}</p>
      )}

      <div className="space-y-4">
        {messages.map((msg) => (
          <MessageCard
            key={msg.id}
            message={msg}
            isLoading={replyMut.isPending}
            onReply={(reply) => replyMut.mutate({ id: msg.id, reply })}
          />
        ))}
      </div>

      {!query.isLoading && messages.length === 0 && (
        <p className="text-gray-500 text-sm">No messages in inbox.</p>
      )}
    </div>
  );
}
